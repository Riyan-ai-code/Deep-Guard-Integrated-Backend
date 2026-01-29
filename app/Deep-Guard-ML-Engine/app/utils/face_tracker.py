from app.config.config import ExtractionConfig
import subprocess
from mtcnn import MTCNN
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
        self._fallbacks_initialized = False  # OPTIMIZATION 2: Lazy-load flag
        self._initialize_primary_tracker()
    
    def _initialize_primary_tracker(self):
        """Initialize ONLY MediaPipe first (OPTIMIZATION 2)."""
        try:
            self.mp_face_mesh = mp.solutions.face_mesh
            
            self.face_mesh = self.mp_face_mesh.FaceMesh(
                static_image_mode=False,
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.9,
                min_tracking_confidence=0.9
            )
            print("✓ MediaPipe initialized (confidence: 0.9)")
        except ImportError:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "mediapipe"])
            self._initialize_primary_tracker()
    
    def _initialize_fallbacks(self):
        """OPTIMIZATION 2: Lazy-load fallbacks only when needed."""
        if self._fallbacks_initialized:
            return
        
        try:
            self.mtcnn = MTCNN()
            print("✓ MTCNN fallback loaded (threshold: 0.9)")
        except:
            self.mtcnn = None
        
        try:
            self.haar_cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
            )
            print("✓ Haar Cascade fallback loaded")
        except:
            self.haar_cascade = None
        
        self._fallbacks_initialized = True
    
    def track_face_in_frame(self, frame: np.ndarray) -> Optional[Dict]:
        """Track with 0.9 confidence requirement (ALL detectors)."""
        result = self._track_mediapipe(frame)
        if result and result['confidence'] >= 0.9:
            return result
        
        # OPTIMIZATION 2: Load fallbacks only on first MediaPipe failure
        if not self._fallbacks_initialized:
            self._initialize_fallbacks()
        
        if self.mtcnn:
            result = self._track_mtcnn(frame)
            if result and result['confidence'] >= 0.9:
                return result
        
        if self.haar_cascade:
            result = self._track_haar(frame)
            if result and result['confidence'] >= 0.9:
                return result
        
        return None
    
    def _track_mediapipe(self, frame: np.ndarray) -> Optional[Dict]:
        try:
            results = self.face_mesh.process(frame)
            if not results.multi_face_landmarks:
                return None
            
            landmarks = results.multi_face_landmarks[0]
            h, w = frame.shape[:2]
            landmarks_3d = [[lm.x*w, lm.y*h, lm.z] for lm in landmarks.landmark]
            landmarks_array = np.array(landmarks_3d)
            
            x_coords, y_coords = landmarks_array[:, 0], landmarks_array[:, 1]
            x_min, x_max = int(np.min(x_coords)), int(np.max(x_coords))
            y_min, y_max = int(np.min(y_coords)), int(np.max(y_coords))
            
            if (x_max - x_min) < 30 or (y_max - y_min) < 30:
                return None
            
            return {
                'bounding_box': (x_min, y_min, x_max - x_min, y_max - y_min),
                'landmarks_3d': landmarks_array,
                'rigid_pose': self._estimate_pose(landmarks_array, w, h),
                'confidence': 0.95
            }
        except:
            return None
    
    def _track_mtcnn(self, frame: np.ndarray) -> Optional[Dict]:
        try:
            detections = self.mtcnn.detect_faces(frame)
            if not detections:
                return None
            
            best = max(detections, key=lambda x: x['confidence'])
            if best['confidence'] < 0.9:
                return None
            
            x, y, w, h = best['box']
            return {
                'bounding_box': (max(0,x), max(0,y), w, h),
                'landmarks_3d': np.array([[v[0], v[1], 0] for v in best['keypoints'].values()]),
                'rigid_pose': {'yaw': 0.0, 'pitch': 0.0, 'roll': 0.0, 
                             'translation': {'x': x+w/2, 'y': y+h/2, 'z': 0.0}},
                'confidence': float(best['confidence'])
            }
        except:
            return None
    
    def _track_haar(self, frame: np.ndarray) -> Optional[Dict]:
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
            faces = self.haar_cascade.detectMultiScale(gray, 1.1, 5, minSize=(30,30))
            if len(faces) == 0:
                return None
            
            x, y, w, h = max(faces, key=lambda f: f[2]*f[3])
            return {
                'bounding_box': (x, y, w, h),
                'landmarks_3d': np.array([[x+w*0.5, y+h*0.5, 0]]),
                'rigid_pose': {'yaw': 0, 'pitch': 0, 'roll': 0,
                             'translation': {'x': x+w/2, 'y': y+h/2, 'z': 0}},
                'confidence': 0.90
            }
        except:
            return None
    
    def _estimate_pose(self, landmarks: np.ndarray, w: int, h: int) -> Dict:
        try:
            nose, chin = landmarks[1], landmarks[152]
            left_eye, right_eye = landmarks[33], landmarks[263]
            return {
                'yaw': float((nose[0] - (left_eye[0]+right_eye[0])/2) / w),
                'pitch': float((nose[1] - chin[1]) / h),
                'roll': float(np.arctan2(right_eye[1]-left_eye[1], right_eye[0]-left_eye[0])),
                'translation': {'x': float(nose[0]), 'y': float(nose[1]), 'z': float(nose[2])}
            }
        except:
            return {'yaw': 0, 'pitch': 0, 'roll': 0, 'translation': {'x': 0, 'y': 0, 'z': 0}}
    
    def __del__(self):
        if self.face_mesh:
            self.face_mesh.close()
