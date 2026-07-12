package com.nexus.app;

public final class RestrictedSettingsGuide {
    private RestrictedSettingsGuide() {}

    public static boolean isApplicable(int sdk) {
        return sdk >= 33;
    }

    public static String instructions() {
        return "Android ha bloccato un'impostazione con limitazioni.\n\n" +
            "1. Apri Info applicazione di Nexus Sync.\n" +
            "2. Tocca il menu ⋮ in alto a destra.\n" +
            "3. Tocca Consenti impostazioni con limitazioni e conferma.\n" +
            "4. Torna qui, riapri Accessibilità e attiva Nexus Sync.\n\n" +
            "Android non consente all'app di eseguire questi passaggi automaticamente.";
    }
}
