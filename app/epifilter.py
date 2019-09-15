import json
from scipy import signal

import ffmpeg
import numpy as np
import av
import statistics
from ffmpeg import input, concat
from itertools import groupby

from mezmorize import Cache

cache = Cache(CACHE_TYPE='filesystem', CACHE_DIR='cache', CACHE_DEFAULT_TIMEOUT=3600*24)


@cache.memoize()
def filterVideo(file, outfile, blur_list, epi, content):
    frames = []
    output = []

    def analyze_chunk(arr):
        print("chunk")
        res = np.average(np.abs(np.square(np.diff(arr, axis=0))))
        print(res)
        return res

    container = av.open(f"{file}.mp4")
    for frame in container.decode(video=0):
        frames.append(frame.to_ndarray(format='rgb24'))
        output.append(0)

        if len(frames) == 30:
            result = analyze_chunk(np.asarray(frames))

            for i in range(30):

                output[-i] = max(output[-i], result)
            frames = frames[15:]

    output[0] = 0

    b, a = signal.butter(5, 0.3, 'low')
    output = signal.filtfilt(b, a, output)

    print(output)
    print(max(output), min(output), statistics.mean(output))

    blur = (np.array(output) > 40).tolist()
    groups = [list(g) for _, g in groupby(blur)]

    json.dump(groups, open("groups.json", "w"))

    in_file = input(f"{file}.mp4")

    commands = []

    start_frame = 0

    for i in groups:
        if i[0] and epi:
            print("blur", start_frame, start_frame + len(i))

            time = len(i)/24
            actual_time = time - 30/24
            if time > 40/24:
                factor = time/actual_time
                print(factor)
                commands.append(in_file.trim(start_frame=start_frame, end_frame=start_frame + len(i) - 1).filter('tmix', frames=30, weights=(",".join(["1"]*30))).setpts(f'(PTS-STARTPTS)*{factor}'))
            else:
                commands.append(in_file.trim(start_frame=start_frame, end_frame=start_frame + len(i) - 1).drawbox(x=0, y=0, width=1000, height=1000, color="black", thickness=9001).setpts(f'PTS-STARTPTS'))
            start_frame += len(i)
        else:
            print("normal", start_frame, start_frame + len(i))
            commands.append(in_file.trim(start_frame=start_frame, end_frame=start_frame + len(i) - 1).setpts('PTS-STARTPTS'))
            start_frame += len(i)
    concat(*commands).output(f"{file}-tmp.mp4").overwrite_output().run()


    int_file = input(f"{file}-tmp.mp4")
    # blur = [(True, 0, start_frame)]
    commands = []
    blur_list[-1][2] = start_frame

    for i in blur_list:
        if i[0] and content:
            print("blur", i[1], i[2])
            commands.append(int_file.trim(start_frame=max(i[1], 0), end_frame=max(i[2]-1, 0)).filter('gblur', sigma=100).setpts('PTS-STARTPTS'))
        else:
            print("normal", i[1], i[2])
            commands.append(int_file.trim(start_frame=max(i[1], 0), end_frame=max(i[2]-1, 0)).setpts('PTS-STARTPTS'))
    concat(*commands).output(f"{outfile}-noaud.mp4").overwrite_output().run()

    aud_file = input(f"{file}.webm")
    vid_file = input(f"{outfile}-noaud.mp4")
    ffmpeg.output(vid_file, aud_file, f"{outfile}-{epi}{content}.mp4").overwrite_output().run()
    return True


