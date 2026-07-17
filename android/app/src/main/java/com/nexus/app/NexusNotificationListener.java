package com.nexus.app;

import android.app.Notification;
import android.app.Person;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class NexusNotificationListener extends NotificationListenerService {
    private NexusAPI api;
    private NotificationEventQueue queue;
    private ExecutorService sender;
    private final AtomicBoolean flushing = new AtomicBoolean(false);

    @Override public void onCreate() {
        super.onCreate();
        api = new NexusAPI(this);
        queue = new NotificationEventQueue(this);
        sender = Executors.newSingleThreadExecutor();
    }

    @Override public void onListenerConnected() {
        super.onListenerConnected();
        flushQueue();
    }

    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || getPackageName().equals(sbn.getPackageName())) return;
        try {
            Notification notification = sbn.getNotification();
            if (notification == null || (sbn.isOngoing() && !sbn.isClearable())) return;
            JSONArray events = isWhatsApp(sbn.getPackageName())
                ? extractWhatsApp(sbn, notification)
                : extractGeneric(sbn, notification);
            if (events.length() == 0) return;
            queue.enqueue(events);
            flushQueue();
        } catch (Exception e) { e.printStackTrace(); }
    }

    private JSONArray extractWhatsApp(StatusBarNotification sbn, Notification notification) {
        JSONArray result = new JSONArray();
        Bundle extras = notification.extras;
        String conversation = firstNonEmpty(
            safe(extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)),
            safe(extras.getCharSequence(Notification.EXTRA_TITLE)), "WhatsApp");
        try {
            Parcelable[] bundles = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
            List<Notification.MessagingStyle.Message> messages = null;
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                messages = Notification.MessagingStyle.Message.getMessagesFromBundleArray(bundles);
            }
            if (messages != null) {
                for (Notification.MessagingStyle.Message message : messages) {
                    if (message == null || message.getText() == null) continue;
                    String body = sanitize(message.getText().toString());
                    if (body.isEmpty()) continue;
                    String senderName = senderName(message);
                    long ts = message.getTimestamp() > 0 ? message.getTimestamp() : sbn.getPostTime();
                    result.put(event(sbn, conversation, senderName, body, ts,
                        "messaging_style", true));
                }
            }
        } catch (Exception ignored) {}

        // WhatsApp versions/devices that do not expose MessagingStyle still provide
        // expanded text or inbox lines. Preserve each visible line as an individual item.
        if (result.length() == 0) {
            CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
            if (lines != null) {
                for (CharSequence line : lines) {
                    String body = sanitize(safe(line));
                    if (!body.isEmpty()) result.put(event(sbn, conversation, conversation,
                        body, sbn.getPostTime(), "text_lines", false));
                }
            }
        }
        if (result.length() == 0) {
            String body = firstNonEmpty(
                safe(extras.getCharSequence(Notification.EXTRA_BIG_TEXT)),
                safe(extras.getCharSequence(Notification.EXTRA_TEXT)),
                safe(extras.getCharSequence(Notification.EXTRA_SUB_TEXT)));
            body = sanitize(body);
            if (!body.isEmpty()) result.put(event(sbn, conversation, conversation, body,
                sbn.getPostTime(), "notification_text", false));
        }
        return result;
    }

    private JSONArray extractGeneric(StatusBarNotification sbn, Notification notification) {
        JSONArray result = new JSONArray();
        Bundle extras = notification.extras;
        String title = sanitize(safe(extras.getCharSequence(Notification.EXTRA_TITLE)));
        String body = firstNonEmpty(
            safe(extras.getCharSequence(Notification.EXTRA_BIG_TEXT)),
            safe(extras.getCharSequence(Notification.EXTRA_TEXT)),
            safe(extras.getCharSequence(Notification.EXTRA_SUB_TEXT)));
        body = sanitize(body);
        if (!body.isEmpty()) result.put(event(sbn, title, title, body, sbn.getPostTime(),
            "notification_text", false));
        return result;
    }

    private JSONObject event(StatusBarNotification sbn, String conversation, String senderName,
                             String body, long ts, String source, boolean complete) {
        JSONObject event = new JSONObject();
        try {
            String app = isWhatsApp(sbn.getPackageName()) ?
                (sbn.getPackageName().contains("w4b") ? "WhatsApp Business" : "WhatsApp") :
                getAppName(sbn.getPackageName());
            event.put("app", app);
            event.put("pkg", sbn.getPackageName());
            event.put("title", sanitize(conversation));
            event.put("conversation", sanitize(conversation));
            event.put("sender", sanitize(senderName));
            event.put("body", body);
            event.put("ts", ts);
            event.put("source", source);
            event.put("complete", complete);
            event.put("notificationKey", sbn.getKey());
            event.put("eventId", NotificationEventQueue.idFor(sbn.getPackageName(),
                conversation, senderName, body, ts));
        } catch (Exception ignored) {}
        return event;
    }

    private String senderName(Notification.MessagingStyle.Message message) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 28) {
                Person person = message.getSenderPerson();
                if (person != null && person.getName() != null) return person.getName().toString();
            }
            CharSequence senderText = message.getSender();
            return senderText == null ? "" : senderText.toString();
        } catch (Exception e) { return ""; }
    }

    private void flushQueue() {
        if (sender == null || !flushing.compareAndSet(false, true)) return;
        sender.execute(() -> {
            try {
                JSONArray pending = queue.pending();
                if (pending.length() > 0 && api.sendEventsNow(pending)) queue.markAllSent(pending);
            } finally { flushing.set(false); }
        });
    }

    private boolean isWhatsApp(String pkg) {
        return "com.whatsapp".equals(pkg) || "com.whatsapp.w4b".equals(pkg);
    }

    private String firstNonEmpty(String... values) {
        for (String value : values) if (value != null && !value.trim().isEmpty()) return value;
        return "";
    }
    private String safe(CharSequence value) { return value == null ? "" : value.toString(); }
    private String sanitize(String value) {
        return value == null ? "" : value.replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]", " ").trim();
    }
    private String getAppName(String pkg) {
        try { return getPackageManager().getApplicationLabel(
            getPackageManager().getApplicationInfo(pkg, 0)).toString(); }
        catch (Exception e) { return pkg; }
    }

    @Override public void onDestroy() {
        if (sender != null) sender.shutdownNow();
        super.onDestroy();
    }
}
