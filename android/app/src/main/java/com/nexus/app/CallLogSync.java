package com.nexus.app;

import android.content.Context;
import android.content.ContentResolver;
import android.database.Cursor;
import android.provider.CallLog;
import android.os.Bundle;
import org.json.JSONArray;
import org.json.JSONObject;

public class CallLogSync {
    private static final int MAX_BATCH = 500;
    private final Context ctx;
    private final NexusAPI api;

    public CallLogSync(Context ctx, NexusAPI api) {
        this.ctx = ctx;
        this.api = api;
    }

    public void sync() {
        try {
            long lastSync = Long.parseLong(NexusConfig.getLastSync(ctx, "calllog"));

            String[] proj = {
                CallLog.Calls.NUMBER,
                CallLog.Calls.CACHED_NAME,
                CallLog.Calls.TYPE,
                CallLog.Calls.DURATION,
                CallLog.Calls.DATE
            };

            String sel = CallLog.Calls.DATE + " > ?";
            String[] args = { String.valueOf(lastSync) };
            Bundle query = new Bundle();
            query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, sel);
            query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args);
            query.putStringArray(ContentResolver.QUERY_ARG_SORT_COLUMNS,
                new String[]{ CallLog.Calls.DATE });
            query.putInt(ContentResolver.QUERY_ARG_SORT_DIRECTION,
                ContentResolver.QUERY_SORT_DIRECTION_ASCENDING);
            query.putInt(ContentResolver.QUERY_ARG_LIMIT, MAX_BATCH);
            Cursor c = ctx.getContentResolver().query(
                CallLog.Calls.CONTENT_URI, proj, query, null);

            if (c == null) return;

            JSONArray calls = new JSONArray();
            long newLastSync = lastSync;

            while (c.moveToNext()) {
                try {
                    String number = c.getString(c.getColumnIndexOrThrow(CallLog.Calls.NUMBER));
                    String name = c.getString(c.getColumnIndexOrThrow(CallLog.Calls.CACHED_NAME));
                    int type = c.getInt(c.getColumnIndexOrThrow(CallLog.Calls.TYPE));
                    int duration = c.getInt(c.getColumnIndexOrThrow(CallLog.Calls.DURATION));
                    long date = c.getLong(c.getColumnIndexOrThrow(CallLog.Calls.DATE));

                    JSONObject call = new JSONObject();
                    call.put("number", number);
                    call.put("name", name != null ? name : "");
                    call.put("type", type);
                    call.put("duration", duration);
                    call.put("date", date);
                    calls.put(call);

                    if (date > newLastSync) newLastSync = date;
                } catch (Exception e) { e.printStackTrace(); }
            }
            c.close();

            if (calls.length() > 0) {
                if (api.sendCallLog(calls)) {
                    NexusConfig.setLastSync(ctx, "calllog", String.valueOf(newLastSync));
                }
            }
        } catch (Exception e) { e.printStackTrace(); }
    }
}
