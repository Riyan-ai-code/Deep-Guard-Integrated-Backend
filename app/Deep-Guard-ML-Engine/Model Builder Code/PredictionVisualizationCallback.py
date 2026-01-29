"""
Simple Prediction Visualization Callback - FIXED SAMPLES
Shows the SAME samples each epoch to track learning progress
"""

import numpy as np
import tensorflow as tf
from tensorflow.keras.callbacks import Callback
import matplotlib.pyplot as plt
import wandb


class PredictionVisualizationCallback(Callback):
    """
    Callback that visualizes predictions on a FIXED set of validation samples.
    Allows you to track how predictions evolve during training.
    """
    
    def __init__(self, val_generator, num_samples=12, threshold=0.5):
        """
        Args:
            val_generator: Validation data generator
            num_samples: Number of samples to visualize (default: 12)
            threshold: Classification threshold (default: 0.5)
        """
        super().__init__()
        self.val_generator = val_generator
        self.threshold = threshold
        self.num_samples = num_samples
        
        # Collect FIXED samples that will be used throughout training
        self.images, self.labels = self._collect_fixed_samples()
        
        print(f"✓ Visualization callback initialized with {len(self.images)} FIXED samples")
        print(f"  → These same samples will be shown each epoch to track learning progress")
    
    def _collect_fixed_samples(self):
        """Collect a fixed set of samples that will be reused"""
        self.val_generator.reset()
        
        X, y = next(self.val_generator)
        
        # Take only the number we need
        num_to_take = min(self.num_samples, len(X))
        
        return X[:num_to_take].copy(), y[:num_to_take].copy()
    
    def on_epoch_end(self, epoch, logs=None):
        """Visualize predictions on the SAME samples each epoch"""
        
        # Get predictions on fixed samples
        predictions = self.model.predict(self.images, verbose=0)
        
        # Create visualization
        self._create_grid(epoch, predictions)
    
    def _create_grid(self, epoch, predictions):
        """Create a grid showing predictions on fixed samples"""
        
        num_images = len(self.images)
        
        # Create grid (4 columns)
        cols = 4
        rows = (num_images + cols - 1) // cols
        
        fig = plt.figure(figsize=(16, 4 * rows))
        
        for i in range(num_images):
            plt.subplot(rows, cols, i + 1)
            
            # Denormalize image from [-1, 1] to [0, 1]
            img = (self.images[i] + 1) / 2.0
            img = np.clip(img, 0, 1)
            
            plt.imshow(img)
            plt.axis('off')
            
            # Get labels
            true_label = "Fake" if self.labels[i] == 1 else "Real"
            pred_prob = predictions[i][0]
            pred_label = "Fake" if pred_prob >= self.threshold else "Real"
            
            # Determine if correct
            is_correct = (self.labels[i] == 1 and pred_prob >= self.threshold) or \
                         (self.labels[i] == 0 and pred_prob < self.threshold)
            
            # Color code: green for correct, red for wrong
            color = 'green' if is_correct else 'red'
            
            # Title showing true label, prediction, and confidence
            # Sample number helps you track specific images across epochs
            title = f"Sample #{i+1}\nTrue: {true_label} | Pred: {pred_label}\nConf: {pred_prob:.3f}"
            plt.title(title, color=color, fontsize=9, weight='bold')
        
        plt.suptitle(
            f'Epoch {epoch + 1} - Fixed Sample Predictions (Track Progress)', 
            fontsize=16, 
            weight='bold'
        )
        plt.tight_layout()
        
        # Log to WandB
        wandb.log({
            'predictions/fixed_samples': wandb.Image(fig),
            'epoch': epoch + 1
        })
        
        plt.close()
