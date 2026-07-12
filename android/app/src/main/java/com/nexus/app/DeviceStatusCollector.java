package com.nexus.app;

import android.app.ActivityManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.PowerManager;
import android.os.StatFs;
import android.os.SystemClock;
import android.provider.Settings;
import org.json.JSONObject;

/** Collects bounded, non-content device health information for diagnostics. */
public final class DeviceStatusCollector {
    private DeviceStatusCollector() {}

    public static JSONObject collect(Context context) {
        JSONObject out = new JSONObject();
        try {
            out.put("timestamp", System.currentTimeMillis());
            out.put("manufacturer", Build.MANUFACTURER);
            out.put("model", Build.MODEL);
            out.put("androidVersion", Build.VERSION.RELEASE);
            out.put("sdk", Build.VERSION.SDK_INT);
            out.put("uptimeMs", SystemClock.elapsedRealtime());

            Intent battery = context.registerReceiver(null,
                new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (battery != null) {
                int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                out.put("batteryPercent", scale > 0 ? Math.round(level * 100f / scale) : -1);
                out.put("batteryTemperatureC",
                    battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0);
                int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                out.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING ||
                    status == BatteryManager.BATTERY_STATUS_FULL);
            }

            PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (power != null) {
                out.put("powerSaveMode", power.isPowerSaveMode());
                if (Build.VERSION.SDK_INT >= 29) out.put("thermalStatus", power.getCurrentThermalStatus());
                out.put("batteryOptimizationIgnored", power.isIgnoringBatteryOptimizations(context.getPackageName()));
            }

            StatFs stat = new StatFs(Environment.getDataDirectory().getAbsolutePath());
            out.put("storageTotalBytes", stat.getTotalBytes());
            out.put("storageFreeBytes", stat.getAvailableBytes());

            ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(memory);
                out.put("memoryTotalBytes", memory.totalMem);
                out.put("memoryAvailableBytes", memory.availMem);
                out.put("lowMemory", memory.lowMemory);
            }

            ConnectivityManager cm = (ConnectivityManager)
                context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                Network active = cm.getActiveNetwork();
                NetworkCapabilities caps = active == null ? null : cm.getNetworkCapabilities(active);
                String transport = "offline";
                if (caps != null) {
                    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) transport = "wifi";
                    else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) transport = "mobile";
                    else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) transport = "ethernet";
                    else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) transport = "vpn";
                }
                out.put("network", transport);
                out.put("networkMetered", cm.isActiveNetworkMetered());
            }

            out.put("accessibilityEnabled", isAccessibilityEnabled(context));
            out.put("notificationListenerEnabled", isNotificationListenerEnabled(context));
            out.put("notificationsEnabled",
                ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).areNotificationsEnabled());
            out.put("externalTreeAuthorized", ExternalTreeSync.hasTree(context));
            PackageInfo packageInfo = context.getPackageManager()
                .getPackageInfo(context.getPackageName(), 0);
            out.put("appVersion", packageInfo.versionName);
            out.put("appVersionCode", Build.VERSION.SDK_INT >= 28
                ? packageInfo.getLongVersionCode() : packageInfo.versionCode);
        } catch (Exception e) {
            try { out.put("partial", true); out.put("error", e.getClass().getSimpleName()); }
            catch (Exception ignored) {}
        }
        return out;
    }

    private static boolean isAccessibilityEnabled(Context context) {
        try {
            if (Settings.Secure.getInt(context.getContentResolver(),
                Settings.Secure.ACCESSIBILITY_ENABLED, 0) != 1) return false;
            String services = Settings.Secure.getString(context.getContentResolver(),
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            return services != null && services.contains(context.getPackageName());
        } catch (Exception e) { return false; }
    }

    private static boolean isNotificationListenerEnabled(Context context) {
        String listeners = Settings.Secure.getString(context.getContentResolver(),
            "enabled_notification_listeners");
        return listeners != null && listeners.contains(context.getPackageName());
    }
}
