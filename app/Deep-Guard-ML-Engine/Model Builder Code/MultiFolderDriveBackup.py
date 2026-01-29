import os
import shutil
from tensorflow.keras.callbacks import Callback

class MultiFolderDriveBackup(Callback):
    """Backup multiple folders to Google Drive (overwrite mode)"""
    
    def __init__(self, source_dirs, drive_dir, backup_frequency="epoch"):
        super().__init__()
        self.source_dirs = source_dirs  # List of folders to backup
        self.drive_dir = drive_dir      # Base Drive path
        self.backup_frequency = backup_frequency
        
        # Ensure drive backup path exists
        os.makedirs(self.drive_dir, exist_ok=True)
    
    def on_epoch_end(self, epoch, logs=None):
        if self.backup_frequency == "epoch":
            self._backup_folders()
    
    def on_train_batch_end(self, batch, logs=None):
        if self.backup_frequency == "batch":
            self._backup_folders()
    
    def _backup_folders(self):
        """Copy all source folders to Drive, overwriting existing ones"""
        for source_dir in self.source_dirs:
            if not os.path.exists(source_dir):
                print(f"⚠️ Skipping {source_dir} (doesn't exist)")
                continue
            
            # Extract just the folder name (e.g., "output_with_weights")
            folder_name = os.path.basename(source_dir)
            dest_path = os.path.join(self.drive_dir, folder_name)
            
            # Remove existing backup if it exists
            if os.path.exists(dest_path):
                shutil.rmtree(dest_path)
            
            # Copy fresh version
            shutil.copytree(source_dir, dest_path)
            print(f"✅ Backed up {folder_name} to Drive")

print("✓ MultiFolderDriveBackup callback defined (overwrite mode)")
