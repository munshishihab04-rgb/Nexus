package com.nexus.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.security.MessageDigest;
import java.util.LinkedHashSet;
import java.util.Set;

/** Persistent bounded outbox and dedup ledger for notification events. */
public final class NotificationEventQueue {
    private static final String PREFS = "nexus_notification_outbox";
    private static final String OUTBOX = "outbox";
    private static final String SENT = "sent_ids";
    private static final int MAX_OUTBOX = 500;
    private static final int MAX_SENT = 2000;
    private final SharedPreferences prefs;

    public NotificationEventQueue(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized void enqueue(JSONArray incoming) {
        try {
            JSONArray outbox = readArray(OUTBOX);
            Set<String> known = sentIds();
            for (int i = 0; i < outbox.length(); i++) known.add(outbox.getJSONObject(i).optString("eventId"));
            for (int i = 0; i < incoming.length(); i++) {
                JSONObject event = incoming.getJSONObject(i);
                String id = event.optString("eventId");
                if (id.isEmpty()) {
                    id = idFor(event.optString("pkg"), event.optString("conversation"),
                        event.optString("sender"), event.optString("body"), event.optLong("ts"));
                    event.put("eventId", id);
                }
                if (!known.contains(id)) { outbox.put(event); known.add(id); }
            }
            while (outbox.length() > MAX_OUTBOX) outbox.remove(0);
            prefs.edit().putString(OUTBOX, outbox.toString()).apply();
        } catch (Exception ignored) {}
    }

    public synchronized JSONArray pending() { return readArray(OUTBOX); }

    public synchronized void markAllSent(JSONArray delivered) {
        try {
            LinkedHashSet<String> ids = new LinkedHashSet<>(sentIds());
            for (int i = 0; i < delivered.length(); i++) {
                String id = delivered.getJSONObject(i).optString("eventId");
                if (!id.isEmpty()) ids.add(id);
            }
            while (ids.size() > MAX_SENT) ids.remove(ids.iterator().next());
            prefs.edit().putString(SENT, new JSONArray(ids).toString())
                .putString(OUTBOX, "[]").apply();
        } catch (Exception ignored) {}
    }

    private Set<String> sentIds() {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        JSONArray arr = readArray(SENT);
        for (int i = 0; i < arr.length(); i++) result.add(arr.optString(i));
        return result;
    }

    private JSONArray readArray(String key) {
        try { return new JSONArray(prefs.getString(key, "[]")); }
        catch (Exception e) { return new JSONArray(); }
    }

    public static String idFor(String pkg, String conversation, String sender, String body, long ts) {
        try {
            String value = pkg + "\n" + conversation + "\n" + sender + "\n" + body + "\n" + ts;
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes("UTF-8"));
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Exception e) { return Integer.toHexString((pkg + conversation + sender + body + ts).hashCode()); }
    }
}
