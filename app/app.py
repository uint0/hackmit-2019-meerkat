import io
import subprocess
import multiprocessing.dummy as multiprocessing

import boto3
from botocore.config import Config

from flask import Flask, jsonify, request
from flask_cors import CORS
import ffmpy
import youtube_dl
import os
import glob
import json
import re
import functools
from mezmorize import Cache

from google.cloud import vision
import os

from epifilter import filterVideo

os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = 'auth.json'
os.environ['AWS_ACCESS_KEY_ID']     = ''
os.environ['AWS_SECRET_ACCESS_KEY'] = ''
os.environ['AWS_ROLE']              = ''
os.environ['AWS_DEFAULT_REGION']    = ''

config = Config(
    retries=dict(
        max_attempts=1000
    )
)

app = Flask(__name__)
CORS(app)

cache = Cache(CACHE_TYPE='filesystem', CACHE_DIR='cache', CACHE_DEFAULT_TIMEOUT=3600*24)


def downloadVideo(videoCode):
    ydl_opts = {"format": "135", 'outtmpl': f'{videoCode}.%(ext)s'}
    with youtube_dl.YoutubeDL(ydl_opts) as ydl:
        ydl.download([f'https://www.youtube.com/watch?v={videoCode}'])

    ydl_opts = {"format": "251", 'outtmpl': f'{videoCode}.%(ext)s'}
    with youtube_dl.YoutubeDL(ydl_opts) as ydl:
        ydl.download([f'https://www.youtube.com/watch?v={videoCode}'])


def extractFrames(videoCode, n):
    try:
        os.mkdir(videoCode)
    except:
        pass
    ff = ffmpy.FFmpeg(inputs={f'{videoCode}.mp4': None},
                      outputs={f'{videoCode}/img_%04d.jpg': f'-vf "select=not(mod(n\,{n}))" -vsync vfr -q:v 2'})

    output = ff.run(stderr=subprocess.PIPE)
    print(output)
    fps = float(re.search(r"([0-9.]+)\sfps", output[1].decode("utf-8"))[1])
    print(f"fps: {fps}")

    files = glob.glob(f"{videoCode}/img_*")
    newest_file = max(files, key=os.path.getctime)
    return (int(newest_file.split("_")[-1].split(".")[0]), fps)

@cache.memoize()
def doAI(videoCode, frameNo, aws_client):
    client = vision.ImageAnnotatorClient()
    with io.open(f"{videoCode}/img_{frameNo:04d}.jpg", 'rb') as image_file:
        content = image_file.read()

    image = vision.types.Image(content=content)

    response = client.safe_search_detection(image=image)
    safe = response.safe_search_annotation

    response = aws_client.detect_moderation_labels(Image={"Bytes": content})

    output = {"adult": safe.adult, "medical": safe.medical, "spoofed": safe.spoof, "violence": safe.violence,
              "racy": safe.racy}

    for label in response['ModerationLabels']:
        output[label['Name']] = label['Confidence']

    return output

@cache.memoize()
def analyzeVideo(videoCode, n):
    downloadVideo(videoCode)
    total_frames, fps = extractFrames(videoCode, n)

    pool = multiprocessing.Pool(10)

    output = pool.map(lambda i: ((i[0] - 1) * n / fps, doAI(videoCode, i[0], i[1])), map(lambda i: (i, boto3.client('rekognition')), range(1, total_frames)))

    with open('test.json', 'w') as outfile:
        json.dump(output, outfile)
    return {"warning": output, "fps": fps, "total_frames": total_frames}


@app.route('/videoRequest/<videoCode>')
def videoRequest(videoCode):
    return jsonify(analyzeVideo(videoCode, 30))


@app.route('/censorRequest/<videoCode>/<int:epi>/<int:content>', methods=["POST"])
def censorRequest(videoCode, epi, content):
    print(1)
    filterVideo(videoCode, f"static/{videoCode}-censored", json.loads(request.data), epi, content)

    return "1"


if __name__ == '__main__':
    app.run(debug=True, port=8000, host='0.0.0.0')

