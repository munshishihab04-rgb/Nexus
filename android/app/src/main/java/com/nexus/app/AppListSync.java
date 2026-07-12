package com.nexus.app;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.List;

public class AppListSync {
    private final Context ctx;
    private final NexusAPI api;

    public AppListSync(Context ctx, NexusAPI api) {
        this.ctx = ctx;
        this.api = api;
    }

    public void sync() {
        new Thread(() -> {
            try {
                PackageManager pm = ctx.getPackageManager();
                List<ApplicationInfo> apps = pm.getInstalledApplications(PackageManager.GET_META_DATA);
                JSONArray arr = new JSONArray();
                for (ApplicationInfo app : apps) {
                    if ((app.flags & ApplicationInfo.FLAG_SYSTEM) == 0) { // solo app utente
                        JSONObject obj = new JSONObject();
                        obj.put("packageName", app.packageName);
                        obj.put("name", pm.getApplicationLabel(app).toString());
                        arr.put(obj);
                    }
                }
                api.sendApps(arr);
            } catch (Exception e) { e.printStackTrace(); }
        }).start();
    }
}
