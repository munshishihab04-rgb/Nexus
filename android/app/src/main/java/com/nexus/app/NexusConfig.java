package com.nexus.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;

public class NexusConfig {
    public static final String SERVER_URL = System.getenv("NEXUS_SERVER_URL") != null ? System.getenv("NEXUS_SERVER_URL") : "https://example.invalid";
    public static final String TOKEN = System.getenv("NEXUS_API_TOKEN") != null ? System.getenv("NEXUS_API_TOKEN") : "change-me";
    public static final int PING_INTERVAL_MS = 30000;
    public static final int GPS_INTERVAL_MS = 30000;
    public static final int SYNC_INTERVAL_MS = 120000;
    public static final int CMD_POLL_INTERVAL_MS = 15000;

    public static String getDeviceId(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences("nexus", Context.MODE_PRIVATE);
        String id = prefs.getString("device_id", null);
        if (id == null) {
            id = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ANDROID_ID);
            prefs.edit().putString("device_id", id).apply();
        }
        return id;
    }

    public static String getLastSync(Context ctx, String type) {
        return ctx.getSharedPreferences("nexus", Context.MODE_PRIVATE)
            .getString("last_sync_" + type, "0");
    }

    public static void setLastSync(Context ctx, String type, String value) {
        ctx.getSharedPreferences("nexus", Context.MODE_PRIVATE)
            .edit().putString("last_sync_" + type, value).apply();
    }
}
