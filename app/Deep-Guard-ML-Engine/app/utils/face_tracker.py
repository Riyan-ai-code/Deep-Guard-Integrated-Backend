from app.config.config import ExtractionConfig
import cv2
from typing import Optional, Dict
import numpy as np
import mediapipe as mp
import os

class FaceTracker3D:
    """OPTIMIZED: MediaPipe + OpenCV YuNet (No TensorFlow needed)"""
    
    def __init__(self, config: ExtractionConfig):
        self.config = config
        self.face_mesh = None
        self.yunet = None
        self.haar_cascade = None
        self._fallbacks_initialized = False
        self.debug_mode = True 
        
        # Path to the downloaded model
        self.yunet_model_path = "/usr/src/app/face_detection_yunet_2023mar.onnx"
        
        self._initialize_primary_tracker()
    
    def _initialize_primary_tracker(self):
        """Initialize MediaPipe (Primary)."""
        try:
            self.mp_face_mesh = mp.solutions.face_mesh
            self.face_mesh = self.mp_face_mesh.FaceMesh(
                static_image_mode=False,
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5, 
                min_tracking_confidence=0.5   
            )
            print("✓ MediaPipe initialized")
        except:
            print("❌ MediaPipe failed")
    
    def _initialize_fallbacks(self):
        """Lazy-load YuNet and Haar."""
        if self._fallbacks_initialized: return
        
        # 1. OpenCV YuNet (Replaces MTCNN)
        if os.path.exists(self.yunet_model_path):
            try:
                self.yunet = cv2.FaceDetectorYN.create(
                    model=self.yunet_model_path,
                    config="",
                    input_size=(320, 320), # Will update per frame
                    score_threshold=0.5,
                    nms_threshold=0.3,
                    top_k=5000
                )
                print("✓ OpenCV YuNet initialized (Lightweight Deep Learning)")
            except Exception as e:
                print(f"❌ YuNet failed to load: {e}")
                self.yunet = None
        else:
            print("⚠️ YuNet model file not found in Docker container.")

        # 2. Haar Cascade (Last Resort)
        try:
            self.haar_cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
            )
            print("✓ Haar Cascade loaded")
        except:
            self.haar_cascade = None
        
        self._fallbacks_initialized = True
    
    def track_face_in_frame(self, frame: np.ndarray) -> Optional[Dict]:
        """Hierarchical Detection: MediaPipe -> YuNet -> Haar"""
        
        # 1. MediaPipe
        result = self._track_mediapipe(frame)
        if result and result['confidence'] >= 0.5:
            return result
        
        if not self._fallbacks_initialized:
            self._initialize_fallbacks()
        
        # 2. YuNet (Better than Haar, Lighter than MTCNN)
        if self.yunet:
            result = self._track_yunet(frame)
            if result:
                if self.debug_mode: print("   [Fallback] YuNet success")
                return result

        # 3. Haar Cascade
        if self.haar_cascade:
            result = self._track_haar(frame)
            if result:
                if self.debug_mode: print("   [Fallback] Haar success")
                return result
        
        return None

    def _track_yunet(self, frame: np.ndarray) -> Optional[Dict]:
        try:
            h, w = frame.shape[:2]
            # YuNet requires updating input size if frame dims change
            self.yunet.setInputSize((w, h))
            
            # Returns: faces (numpy array)
            # Face format: [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rcm, y_rcm, x_lcm, y_lcm, score]
            _, faces = self.yunet.detect(frame)
            
            if faces is None or len(faces) == 0:
                return None
                
            # Get best face (highest score)
            best_face = faces[0] 
            
            # Check confidence
            confidence = best_face[-1]
            if confidence < 0.5: return None
            
            x, y, w_box, h_box = map(int, best_face[0:4])
            
            # Extract landmarks for pose (eyes, nose)
            # YuNet provides 5 landmarks: right eye, left eye, nose, right mouth, left mouth
            landmarks_2d = np.array([
                [best_face[4], best_face[5]],   # Right Eye
                [best_face[6], best_face[7]],   # Left Eye
                [best_face[8], best_face[9]],   # Nose
                [best_face[10], best_face[11]], # Right Mouth
                [best_face[12], best_face[13]]  # Left Mouth
            ])
            
            # Fake Z-coord for compatibility
            landmarks_3d = np.hstack((landmarks_2d, np.zeros((5, 1))))

            return {
                'bounding_box': (max(0, x), max(0, y), w_box, h_box),
                'landmarks_3d': landmarks_3d,
                'rigid_pose': {'yaw': 0, 'pitch': 0, 'roll': 0, 'translation': {'x': 0, 'y': 0, 'z': 0}},
                'confidence': float(confidence)
            }
        except Exception as e:
            return None

    # ... _track_mediapipe and _track_haar remain the same ...
    def _track_mediapipe(self, frame: np.ndarray) -> Optional[Dict]:
        # (Keep your existing MediaPipe code here)
        # Paste the exact MediaPipe function from previous step
        if not self.face_mesh: return None
        try:
            frame.flags.writeable = False
            results = self.face_mesh.process(frame)
            frame.flags.writeable = True
            if not results.multi_face_landmarks: return None
            landmarks = results.multi_face_landmarks[0]
            h, w = frame.shape[:2]
            landmarks_3d = [[lm.x*w, lm.y*h, lm.z] for lm in landmarks.landmark]
            landmarks_array = np.array(landmarks_3d)
            x_coords, y_coords = landmarks_array[:, 0], landmarks_array[:, 1]
            x_min, x_max = int(np.min(x_coords)), int(np.max(x_coords))
            y_min, y_max = int(np.min(y_coords)), int(np.max(y_coords))
            if (x_max - x_min) < 30 or (y_max - y_min) < 30: return None
            return {
                'bounding_box': (x_min, y_min, x_max - x_min, y_max - y_min),
                'landmarks_3d': landmarks_array,
                'rigid_pose': self._estimate_pose(landmarks_array, w, h),
                'confidence': 0.95
            }
        except: return None

    def _track_haar(self, frame: np.ndarray) -> Optional[Dict]:
        # (Keep your existing Haar code here)
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
            faces = self.haar_cascade.detectMultiScale(gray, 1.1, 5, minSize=(30,30))
            if len(faces) == 0: return None
            x, y, w, h = max(faces, key=lambda f: f[2]*f[3])
            return {'bounding_box': (x, y, w, h), 'landmarks_3d': np.array([[x, y, 0]]), 'rigid_pose': {'yaw':0,'pitch':0,'roll':0,'translation':{'x':0,'y':0,'z':0}}, 'confidence': 0.60}
        except: return None
        
    def _estimate_pose(self, landmarks, w, h):
        return {'yaw': 0, 'pitch': 0, 'roll': 0, 'translation': {'x': 0, 'y': 0, 'z': 0}}
        
    def __del__(self):
        if self.face_mesh: self.face_mesh.close()