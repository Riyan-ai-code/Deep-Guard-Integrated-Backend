"""
model_builder.py
Modular utilities for building, fine-tuning, and resuming an Xception-based binary classifier.
"""

import os
import json
import numpy as np
import tensorflow as tf
from tensorflow.keras.models import Model
from tensorflow.keras.layers import Dense, Dropout, GlobalAveragePooling2D, GlobalMaxPooling2D, concatenate
from tensorflow.keras.applications import Xception
from tensorflow.keras.optimizers import Adam


# ============================================================
# 1️⃣ BUILD BASE MODEL
# ============================================================
def build_model(image_size=299, learning_rate=1e-4):
    """Build Xception-based binary classification model."""

    base_model = Xception(
        weights="imagenet",
        include_top=False,
        input_shape=(image_size, image_size, 3)
    )
    base_model.trainable = False

    x = base_model.output
    gap = GlobalAveragePooling2D()(x)
    gmp = GlobalMaxPooling2D()(x)
    x = concatenate([gap, gmp])

    # Deep classification head with L2 regularization
    # x = Dense(1024, activation="relu", kernel_regularizer=tf.keras.regularizers.l2(0.01))(x)
    # x = Dropout(0.5)(x)
    # x = Dense(512, activation="relu", kernel_regularizer=tf.keras.regularizers.l2(0.01))(x)
    # x = Dropout(0.3)(x)
    # x = Dense(256, activation="relu", kernel_regularizer=tf.keras.regularizers.l2(0.01))(x)
    # x = Dropout(0.2)(x)

    outputs = Dense(1, activation="sigmoid", dtype="float32", name="predictions")(x)
    model = Model(inputs=base_model.input, outputs=outputs, name="XceptionNet_Deepfake")

    model.compile(
        optimizer=Adam(learning_rate=learning_rate),
        loss="binary_crossentropy",
        metrics=[
            "accuracy",
            tf.keras.metrics.AUC(name="auc"),
            tf.keras.metrics.Precision(name="precision"),
            tf.keras.metrics.Recall(name="recall"),
        ],
    )

    return model


# ============================================================
# 2️⃣ UNFREEZE TOP LAYERS (for fine-tuning)
# ============================================================
def unfreeze_all_layers(model, learning_rate=1e-5):
    """Unfreeze the entire Xception model for full fine-tuning."""
    
    model.trainable = True
    
    has_nested_model = any(isinstance(layer, tf.keras.Model) for layer in model.layers)
    
    if has_nested_model:
        base_model = next((layer for layer in model.layers if isinstance(layer, tf.keras.Model)), None)
        if base_model:
            base_model.trainable = True
            print(f"\n✓ Fully unfrozen base model: {base_model.name} ({len(base_model.layers)} layers)")
    else:
        # 🔧 FIX: Explicitly unfreeze each layer in flattened model
        for layer in model.layers:
            layer.trainable = True
        print(f"\n✓ Fully unfrozen flattened model ({len(model.layers)} layers)")
    
    model.compile(
        optimizer=Adam(learning_rate=learning_rate),
        loss="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.AUC(name="auc"), 
                 tf.keras.metrics.Precision(name="precision"), 
                 tf.keras.metrics.Recall(name="recall")],
    )
    
    trainable_layers = sum(1 for layer in model.layers if layer.trainable)
    total_params = model.count_params()
    trainable_params = sum([np.prod(w.shape) for w in model.trainable_weights])
    
    print(f"✓ All layers unfrozen → {trainable_layers}/{len(model.layers)} trainable")
    print(f"✓ Trainable params: {trainable_params:,}/{total_params:,}\n")
    
    return model




# ============================================================
# 3️⃣ LOAD OR BUILD MODEL
# ============================================================
def load_or_build_model(train_data, checkpoint_dir, resume_from_checkpoint=True):
    """Load model from checkpoint or build a new one."""

    model = None
    initial_epoch = 0

    state_path = os.path.join(checkpoint_dir, "training_state.json")
    model_path = os.path.join(checkpoint_dir, "best_model.keras")
    weights_path = os.path.join(checkpoint_dir, "optimizer_weights.npy")
    if resume_from_checkpoint and os.path.exists(state_path):
        try:
            with open(state_path, "r") as f:
                state = json.load(f)
            initial_epoch = state.get("epoch", 0)
            print(f"\n🔄 Resuming from checkpoint (epoch {initial_epoch})")

            if os.path.exists(model_path):
                model = tf.keras.models.load_model(model_path)
                print("✓ Model restored from disk")

                if os.path.exists(weights_path):
                    dummy_batch = next(iter(train_data))
                    model.train_on_batch(dummy_batch[0][:1], dummy_batch[1][:1])
                    optimizer_weights = np.load(weights_path, allow_pickle=True)
                    model.optimizer.set_weights(optimizer_weights)
                    print("✓ Optimizer weights restored")

            else:
                print("⚠️ Model file missing — building new model")
                model = build_model()
                initial_epoch = 0

        except Exception as e:
            print(f"⚠️ Failed to restore checkpoint: {e}")
            model = build_model()
            initial_epoch = 0
    else:
        print("\n🆕 Building new model...")
        model = build_model()
        initial_epoch = 0

    print(f"\n✅ Model ready with {model.count_params():,} parameters")
    print(f"   Starting from epoch {initial_epoch + 1}\n")

    return model, initial_epoch
