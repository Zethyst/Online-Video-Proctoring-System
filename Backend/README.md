# Real Time Proctoring && Video Proctoring

Enhance proctoring system: Improve face detection, gaze tracking with deep learning models (e.g., TensorFlow), integrate robust mobile phone detection, and optimize multi-person detection using OpenCV for real-time monitoring and terminal output.

## Features

- **Face Detection**: Uses OpenCV's Haar Cascades to detect faces in the video feed.
- **Gaze Detection**: Analyzes the position of the detected face to determine if the person is looking away.
- **Emotion Detection**: Identifies the dominant emotion of the detected face using the FER library.
- **Mobile Phone Detection**: Utilizes a pre-trained TensorFlow object detection model to identify mobile phones in the video feed.
- **Multiple People Detection**: Counts the number of faces in the frame to detect the presence of multiple people.

## Installation

```bash
pip install -r requirements.txt

curl -O http://download.tensorflow.org/models/object_detection/ssd_mobilenet_v2_coco_2018_03_29.tar.gz
tar -xvzf ssd_mobilenet_v2_coco_2018_03_29.tar.gz

```

make sure to have  moviepy of version 1.0.3
or else install it 
```
pip install moviepy==1.0.3

```
## Usage
Run the server to start monitoring:

```bash
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```
## License
This project is licensed under the MIT License - see the LICENSE file for details.
