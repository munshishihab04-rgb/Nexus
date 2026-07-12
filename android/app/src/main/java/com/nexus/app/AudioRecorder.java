package com.nexus.app;

import android.content.Context;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import java.io.File;

public class AudioRecorder {
    private final Context ctx;
    private final NexusAPI api;

    public AudioRecorder(Context ctx, NexusAPI api) {
        this.ctx = ctx;
        this.api = api;
    }

    public void record(int seconds) {
        new Thread(() -> {
            MediaRecorder recorder = null;
            File outFile = null;
            try {
                outFile = new File(ctx.getCacheDir(), "audio_" + System.currentTimeMillis() + ".m4a");
                recorder = new MediaRecorder(ctx);
                recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
                recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                recorder.setAudioSamplingRate(44100);
                recorder.setAudioEncodingBitRate(128000);
                recorder.setOutputFile(outFile.getAbsolutePath());
                recorder.prepare();
                recorder.start();
                Thread.sleep(seconds * 1000L);
                recorder.stop();
                api.uploadAudio(outFile);
            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                try { if (recorder != null) recorder.release(); } catch (Exception e) {}
                if (outFile != null && outFile.exists()) outFile.delete();
            }
        }).start();
    }
}
