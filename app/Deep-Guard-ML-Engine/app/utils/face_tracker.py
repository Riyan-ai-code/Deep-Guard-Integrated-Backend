from app.config.config import ExtractionConfig
import cv2
from typing import Optional, Dict
import numpy as np
import mediapipe as mp
import sys

class FaceTracker3D:
    """OPTIMIZED: 3D face tracking with lazy-loaded fallbacks."""
    
    def __init__(self, config: ExtractionConfig):
        self.config = config
        self.face_mesh = None
        self.mtcnn = None
        self.haar_cascade = None
        self._fallbacks_initialized = False
        
        # DEBUG MODE: Prints exactly what is happening
        self.debug_mode = True 
        
        self._initialize_primary_tracker()
    
    def _initialize_primary_tracker(self):
        """Initialize ONLY MediaPipe first (Lightweight)."""
        try:
            self.mp_face_mesh = mp.solutions.face_mesh
            
            # 🟢 FIX: Threshold lowered to 0.5 (Standard for video)
            self.face_mesh = self.mp_face_mesh.FaceMesh(
                static_image_mode=False,
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5, 
                min_tracking_confidence=0.5   
            )
            print("✓ MediaPipe initialized (confidence: 0.5)")
        except ImportError:
            print("❌ MediaPipe import failed.")
    
    def _initialize_fallbacks(self):
        """Lazy-load fallbacks only when needed."""
        if self._fallbacks_initialized: return
        
        # 1. MTCNN (Only if present)
        try:
            from mtcnn import MTCNN 
            self.mtcnn = MTCNN()
            print("✓ MTCNN fallback loaded")
        except ImportError:
            # Silent fail - we don't need it if MediaPipe works
            self.mtcnn = None
        except Exception:
            self.mtcnn = None
        
        # 2. Haar Cascade (Reliable, Built-in Fallback)
        try:
            self.haar_cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
            )
            print("✓ Haar Cascade fallback loaded")
        except:
            self.haar_cascade = None
        
        self._fallbacks_initialized = True
    
    def track_face_in_frame(self, frame: np.ndarray) -> Optional[Dict]:
        """Track with 0.5 confidence requirement."""
        
        # 1. Try MediaPipe
        result = self._track_mediapipe(frame)
        if result and result['confidence'] >= 0.5:
            return result
        elif self.debug_mode:
             # Log low confidence to help debugging
             conf = result['confidence'] if result else 0
             if conf > 0: print(f"   [MediaPipe Low Conf]: {conf:.2f}")
        
        # 2. Load Fallbacks (Only if MediaPipe fails)
        if not self._fallbacks_initialized:
            self._initialize_fallbacks()
        
        # 3. Try MTCNN (if installed)
        if self.mtcnn:
            result = self._track_mtcnn(frame)
            if result and result['confidence'] >= 0.5:
                if self.debug_mode: print("   [Fallback] MTCNN success")
                return result
        
        # 4. Try Haar Cascade (Last resort)
        if self.haar_cascade:
            result = self._track_haar(frame)
            if result and result['confidence'] >= 0.5:
                if self.debug_mode: print("   [Fallback] Haar success")
                return result
        
        return None
    
    def _track_mediapipe(self, frame: np.ndarray) -> Optional[Dict]:
        if not self.face_mesh: return None
        try:
            frame.flags.writeable = False
            results = self.face_mesh.process(frame)
            frame.flags.writeable = True

            if not results.multi_face_landmarks:
                return None
            
            landmarks = results.multi_face_landmarks[0]
            h, w = frame.shape[:2]
            landmarks_3d = [[lm.x*w, lm.y*h, lm.z] for lm in landmarks.landmark]
            landmarks_array = np.array(landmarks_3d)
            
            x_coords = landmarks_array[:, 0]
            x_min, x_max = int(np.min(x_coords)), int(np.max(x_coords))
            y_coords = landmarks_array[:, 1]
            y_min, y_max = int(np.min(y_coords)), int(np.max(y_coords))
            
            # Reject if face is too small (<30px)
            if (x_max - x_min) < 30 or (y_max - y_min) < 30:
                return None
            
            return {
                'bounding_box': (x_min, y_min, x_max - x_min, y_max - y_min),
                'landmarks_3d': landmarks_array,
                'rigid_pose': self._estimate_pose(landmarks_array, w, h),
                'confidence': 0.95 
            }
        except Exception:
            return None
    
    def _track_mtcnn(self, frame: np.ndarray) -> Optional[Dict]:
        try:
            detections = self.mtcnn.detect_faces(frame)
            if not detections: return None
            best = max(detections, key=lambda x: x['confidence'])
            if best['confidence'] < 0.5: return None
            
            x, y, w, h = best['box']
            return {
                'bounding_box': (max(0,x), max(0,y), w, h),
                'landmarks_3d': np.array([[v[0], v[1], 0] for v in best['keypoints'].values()]),
                'rigid_pose': {'yaw': 0, 'pitch': 0, 'roll': 0, 'translation': {'x': 0, 'y': 0, 'z': 0}},
                'confidence': float(best['confidence'])
            }
        except: return None
    
    def _track_haar(self, frame: np.ndarray) -> Optional[Dict]:
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
            faces = self.haar_cascade.detectMultiScale(gray, 1.1, 5, minSize=(30,30))
            if len(faces) == 0: return None
            x, y, w, h = max(faces, key=lambda f: f[2]*f[3])
            return {
                'bounding_box': (x, y, w, h),
                'landmarks_3d': np.array([[x+w*0.5, y+h*0.5, 0]]),
                'rigid_pose': {'yaw': 0, 'pitch': 0, 'roll': 0, 'translation': {'x': 0, 'y': 0, 'z': 0}},
                'confidence': 0.60 
            }
        except: return None
    
    def _estimate_pose(self, landmarks, w, h):
        return {'yaw': 0, 'pitch': 0, 'roll': 0, 'translation': {'x': 0, 'y': 0, 'z': 0}}

    def __del__(self):
        if self.face_mesh: self.face_mesh.close()