import os
import json
import numpy as np
import wandb
from tensorflow.keras.callbacks import Callback


class WeightsSavingCallback(Callback):
    """Save full model + optimizer weights to WandB"""
    
    def __init__(self, checkpoint_dir, monitor='val_auc', mode='max'):
        super().__init__()
        self.checkpoint_dir = checkpoint_dir
        self.monitor = monitor
        self.mode = mode
        self.best_value = -np.inf if mode == 'max' else np.inf
        self.epochs_completed = 0
    
    def on_epoch_end(self, epoch, logs=None):
        current_value = logs.get(self.monitor, 0)
        
        # Check if improved
        improved = False
        if self.mode == 'max':
            if current_value > self.best_value:
                improved = True
                self.best_value = current_value
        else:
            if current_value < self.best_value:
                improved = True
                self.best_value = current_value
        
        # ✅ ALWAYS update and save epoch state (LOCALLY)
        self.epochs_completed = epoch + 1
        state = {
            'epoch': self.epochs_completed,
            'best_metric': float(self.best_value),
            'monitor': self.monitor,
            'mode': self.mode
        }
        
        state_path = os.path.join(self.checkpoint_dir, 'training_state.json')
        with open(state_path, 'w') as f:
            json.dump(state, f, indent=2)
        
        # ✅ Only save model/weights when improved
        if improved:
            print(f"\n💾 {self.monitor} improved to {current_value:.4f}, saving checkpoint...")
            
            # Save model
            model_path = os.path.join(self.checkpoint_dir, 'best_model.keras')
            self.model.save(model_path, save_format='keras')
            
            # ✅ FIXED: Use variables() instead of get_weights()
            optimizer_variables = self.model.optimizer.variables
            weights_path = os.path.join(self.checkpoint_dir, 'optimizer_weights.npy')
            np.save(weights_path, np.array([v.numpy() for v in optimizer_variables], dtype=object), allow_pickle=True)
            
            # Upload to WandB (best model only)
            artifact = wandb.Artifact(
                name='checkpoint',
                type='model',
                description=f'Best model checkpoint (epoch {self.epochs_completed}, {self.monitor}={current_value:.4f})',
                metadata=state
            )
            
            artifact.add_file(model_path)
            artifact.add_file(weights_path)
            artifact.add_file(state_path)
            wandb.log_artifact(artifact)
            print(f" ✓ Checkpoint saved to WandB (epoch {self.epochs_completed})")


print("✓ Custom checkpoint callback defined")
