package app.sff.signal;

import android.app.*;
import android.os.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.*;
import android.graphics.Color;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.util.*;
import java.lang.ref.WeakReference;
import org.json.JSONObject;

public class Main extends Activity {
  private static volatile boolean appForeground = false;
  public static boolean isForeground() { return appForeground; }
  @Override protected void onResume() { super.onResume(); appForeground = true; }
  @Override protected void onPause() { appForeground = false; super.onPause(); }
  static WeakReference<Main> current = new WeakReference<>(null);
  static final String PUSH_REGISTER_ACTION = "app.sff.signal.REGISTER_PUSH";
  // Only an authenticated page on our own HTTPS origin receives the token.
  public static void deliverPushToken(String token) {
    final Main activity = current.get();
    if (activity == null || activity.destroyed || token == null || token.isEmpty()) return;
    activity.runOnUiThread(() -> {
      if (activity.web == null || !activity.mainPageLoaded ||
          !activity.same(Uri.parse(activity.web.getUrl() == null ? "" : activity.web.getUrl())))
        return;
      activity.web.evaluateJavascript("window.SFFOnPushToken?.(" + JSONObject.quote(token) + ")", null);
    });
  }
  static final String DEFAULT_ORIGIN = "__SFF_SERVER_URL__";
  static final long[] RETRY_DELAYS = {1500, 3000, 5000, 8000, 12000, 20000, 30000};

  WebView web;
  LinearLayout shell, errorBox;
  FrameLayout holder;
  TextView errorTitle, errorText;
  Button retryButton;
  String origin;
  PermissionRequest pending;
  ValueCallback<Uri[]> files;
  long lastNotice;
  Handler retryHandler = new Handler(Looper.getMainLooper());
  Runnable retryRunnable;
  int retryAttempt = 0;
  boolean mainPageLoaded = false;
  boolean destroyed = false;
  ConnectivityManager connectivity;
  ConnectivityManager.NetworkCallback networkCallback;

  public class Notices {
    @JavascriptInterface public void registerPush() {
      runOnUiThread(() -> {
        if (web == null || !mainPageLoaded ||
            !same(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) return;
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED)
          requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 35);
        // Firebase implementation lives only in the optional Gradle/Firebase APK.
        // Existing non-Firebase builds have no receiver and continue normally.
        sendBroadcast(new Intent(PUSH_REGISTER_ACTION)
          .setClassName(getPackageName(),getPackageName()+".SffTokenReceiver"));
      });
    }
    @JavascriptInterface public void ask() {
      runOnUiThread(() -> {
        if (Build.VERSION.SDK_INT >= 33)
          requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 35);
      });
    }

    @JavascriptInterface public void openExternal(String url) {
      runOnUiThread(() -> {
        if (web == null || !mainPageLoaded ||
            !same(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) return;
        try {
          Uri target = Uri.parse(url);
          if (!"https".equals(target.getScheme()) ||
              !"meet.jit.si".equals(target.getHost()) ||
              !target.getPath().matches("/SFF-[a-f0-9]{32}")) return;
          Intent browser = new Intent(Intent.ACTION_VIEW,target)
            .addCategory(Intent.CATEGORY_BROWSABLE);
          startActivity(browser);
        } catch (Exception ignored) {}
      });
    }

    @JavascriptInterface public void show(String title) {
      runOnUiThread(() -> {
        if (System.currentTimeMillis() - lastNotice < 2000 || !same(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) return;
        lastNotice = System.currentTimeMillis();
        NotificationManager manager = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        if (!manager.areNotificationsEnabled()) return;
        manager.createNotificationChannel(new NotificationChannel("messages", "Poruke", NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open = PendingIntent.getActivity(Main.this, 0,
          new Intent(Main.this, Main.class).setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP),
          PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        manager.notify(4178, new Notification.Builder(Main.this, "messages")
          .setSmallIcon(getResources().getIdentifier("mark", "drawable", getPackageName()))
          .setContentTitle("SFF")
          .setContentText(title.substring(0, Math.min(100, title.length())))
          .setContentIntent(open).setAutoCancel(true).build());
      });
    }
  }

  boolean same(Uri uri) {
    return origin != null && origin.equals(uri.getScheme() + "://" + uri.getEncodedAuthority());
  }

  boolean hasNetwork() {
    if (connectivity == null) return true;
    Network network = connectivity.getActiveNetwork();
    if (network == null) return false;
    NetworkCapabilities caps = connectivity.getNetworkCapabilities(network);
    return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
  }

  void cancelRetry() {
    if (retryRunnable != null) retryHandler.removeCallbacks(retryRunnable);
    retryRunnable = null;
  }

  void showConnecting(String text) {
    errorTitle.setText("Povezivanje sa SFF…");
    errorText.setText(text);
    retryButton.setVisibility(View.GONE);
    errorBox.setVisibility(View.VISIBLE);
  }

  void showConnectionError(String detail) {
    errorTitle.setText(hasNetwork() ? "SFF trenutno nije dostupan" : "Nema internet veze");
    errorText.setText(hasNetwork()
      ? "Veza sa SFF serverom je prekinuta. Aplikacija će pokušati ponovo automatski.\n\n" + detail
      : "Proveri Wi‑Fi ili mobilne podatke. SFF će nastaviti čim se internet vrati.");
    retryButton.setVisibility(View.VISIBLE);
    errorBox.setVisibility(View.VISIBLE);
  }

  void hideConnectionError() {
    cancelRetry();
    retryAttempt = 0;
    errorBox.setVisibility(View.GONE);
  }

  void loadHome(boolean userInitiated) {
    if (origin == null || destroyed) return;
    cancelRetry();
    if (!hasNetwork()) {
      showConnectionError("Internet nije dostupan.");
      scheduleRetry();
      return;
    }
    if (userInitiated) retryAttempt = 0;
    showConnecting("Uspostavljanje sigurne veze…");
    web.stopLoading();
    web.loadUrl(origin + "/");
  }

  void scheduleRetry() {
    if (origin == null || destroyed || retryRunnable != null) return;
    long delay = RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)];
    retryAttempt++;
    retryRunnable = () -> {
      retryRunnable = null;
      if (destroyed) return;
      if (!hasNetwork()) {
        showConnectionError("Internet nije dostupan.");
        scheduleRetry();
        return;
      }
      loadHome(false);
    };
    retryHandler.postDelayed(retryRunnable, delay);
  }

  void config() {
    EditText input = new EditText(this);
    input.setSingleLine();
    input.setInputType(17);
    input.setHint("https://sff.example.com");
    input.setText(origin == null ? "" : origin);
    AlertDialog d = new AlertDialog.Builder(this)
      .setTitle("SFF · Adresa servera")
      .setMessage("Unesi HTTPS adresu SFF servera. Za USB vezu koristi http://localhost:4178 uz adb reverse.")
      .setView(input).setPositiveButton("Poveži se", null).setNegativeButton("Zatvori", null).create();
    d.show();
    d.getButton(-1).setOnClickListener(v -> {
      Uri u = Uri.parse(input.getText().toString().trim());
      if (u.getHost() == null || u.getUserInfo() != null || !("https".equals(u.getScheme()) || ("http".equals(u.getScheme()) && Arrays.asList("localhost", "127.0.0.1").contains(u.getHost())))) {
        input.setError("Potrebna je ispravna adresa servera.");
        return;
      }
      origin = u.getScheme() + "://" + u.getEncodedAuthority();
      getPreferences(0).edit().putString("server", origin).apply();
      web.clearHistory();
      loadHome(true);
      d.dismiss();
    });
  }

  @Override public void onCreate(Bundle b) {
    super.onCreate(b);
    current = new WeakReference<>(this);
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
      NotificationChannel channel=new NotificationChannel(
        "sff_incoming_calls","Dolazni SFF pozivi",NotificationManager.IMPORTANCE_HIGH);
      channel.setDescription("Zvonjenje kada vas prijatelj poziva preko SFF aplikacije");
      channel.enableVibration(true);
      channel.setSound(android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE),
        new android.media.AudioAttributes.Builder().setUsage(
          android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());
      manager.createNotificationChannel(channel);
    }
    connectivity = (ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);

    shell = new LinearLayout(this);
    shell.setOrientation(LinearLayout.VERTICAL);
    shell.setBackgroundColor(Color.rgb(21, 19, 24));
    setContentView(shell);
    shell.setOnApplyWindowInsetsListener((view, i) -> {
      if (Build.VERSION.SDK_INT >= 30) {
        android.graphics.Insets s = i.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
        view.setPadding(s.left, s.top, s.right, s.bottom);
      } else view.setPadding(0, i.getSystemWindowInsetTop(), 0, i.getSystemWindowInsetBottom());
      return i;
    });

    TextView bar = new TextView(this);
    bar.setText("   SFF");
    bar.setTextColor(0xffffa3ad);
    bar.setPadding(12, 12, 12, 12);
    shell.addView(bar);

    holder = new FrameLayout(this);
    shell.addView(holder, new LinearLayout.LayoutParams(-1, 0, 1));

    web = new WebView(this);
    web.setBackgroundColor(0xff151318);
    holder.addView(web, new FrameLayout.LayoutParams(-1, -1));

    errorBox = new LinearLayout(this);
    errorBox.setOrientation(LinearLayout.VERTICAL);
    errorBox.setGravity(Gravity.CENTER);
    errorBox.setPadding(36, 36, 36, 36);
    errorBox.setBackgroundColor(0xff151318);
    FrameLayout.LayoutParams errorParams = new FrameLayout.LayoutParams(-1, -1);
    holder.addView(errorBox, errorParams);

    errorTitle = new TextView(this);
    errorTitle.setTextColor(0xffffa3ad);
    errorTitle.setTextSize(20);
    errorTitle.setGravity(Gravity.CENTER);
    errorBox.addView(errorTitle, new LinearLayout.LayoutParams(-1, -2));

    errorText = new TextView(this);
    errorText.setTextColor(0xffd6c9cf);
    errorText.setTextSize(14);
    errorText.setGravity(Gravity.CENTER);
    errorText.setPadding(0, 18, 0, 22);
    errorBox.addView(errorText, new LinearLayout.LayoutParams(-1, -2));

    retryButton = new Button(this);
    retryButton.setText("Pokušaj ponovo");
    retryButton.setOnClickListener(v -> loadHome(true));
    errorBox.addView(retryButton, new LinearLayout.LayoutParams(-2, -2));
    showConnecting("Pokretanje aplikacije…");

    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setCacheMode(WebSettings.LOAD_DEFAULT);

    web.setWebViewClient(new WebViewClient() {
      @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
        if (same(Uri.parse(url))) showConnecting("Učitavanje SFF-a…");
      }

      @Override public void onPageFinished(WebView view, String url) {
        if (same(Uri.parse(url))) {
          mainPageLoaded = true;
          hideConnectionError();
        }
      }

      @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (!request.isForMainFrame()) return;
        mainPageLoaded = false;
        String detail = "Greška veze";
        if (error != null && error.getDescription() != null) detail += ": " + error.getDescription().toString();
        showConnectionError(detail);
        view.stopLoading();
        scheduleRetry();
      }

      @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        if (!request.isForMainFrame() || response == null || response.getStatusCode() < 500) return;
        mainPageLoaded = false;
        showConnectionError("Server je privremeno odgovorio greškom " + response.getStatusCode() + ".");
        scheduleRetry();
      }

      @Override public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
        handler.cancel();
        mainPageLoaded = false;
        showConnectionError("Sigurna HTTPS veza nije mogla da se potvrdi. Proveri datum/vreme telefona i mrežu.");
        scheduleRetry();
      }

      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        Uri uri = r.getUrl();
        if (same(uri)) return false;
        if (r.hasGesture() && Arrays.asList("https", "http").contains(uri.getScheme()))
          new AlertDialog.Builder(Main.this).setTitle("Spoljni link").setMessage(uri.getHost())
            .setNegativeButton("Zatvori", null)
            .setPositiveButton("Kopiraj link", (dialog, which) -> {
              android.content.ClipboardManager clipboard = (android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
              clipboard.setPrimaryClip(ClipData.newPlainText("SFF", uri.toString()));
            }).show();
        return true;
      }
    });

    web.addJavascriptInterface(new Notices(), "SFFAndroid");
    web.setWebChromeClient(new WebChromeClient() {
      @Override public void onPermissionRequest(PermissionRequest p) {
        if (!same(p.getOrigin())) { p.deny(); return; }
        pending = p;
        ArrayList<String> ask = new ArrayList<>();
        for (String r : p.getResources()) {
          String permission = r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE) ? android.Manifest.permission.RECORD_AUDIO :
            r.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE) ? android.Manifest.permission.CAMERA : null;
          if (permission != null && checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) ask.add(permission);
        }
        if (ask.isEmpty()) grant(); else requestPermissions(ask.toArray(new String[0]), 25);
      }

      @Override public void onPermissionRequestCanceled(PermissionRequest p) { if (pending == p) pending = null; }

      @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
        if (files != null) files.onReceiveValue(null);
        files = cb;
        try { startActivityForResult(p.createIntent(), 42); return true; }
        catch (Exception e) { files = null; return false; }
      }
    });

    web.setDownloadListener((url, ua, disposition, mime, size) -> {
      Uri uri = Uri.parse(url);
      if (!same(uri)) return;
      DownloadManager.Request r = new DownloadManager.Request(uri);
      String cookie = CookieManager.getInstance().getCookie(url);
      if (cookie != null) r.addRequestHeader("Cookie", cookie);
      String name = URLUtil.guessFileName(url, disposition, mime).replaceAll("[^a-zA-Z0-9._-]", "_");
      r.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name);
      r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
      ((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
    });

    networkCallback = new ConnectivityManager.NetworkCallback() {
      @Override public void onAvailable(Network network) {
        runOnUiThread(() -> {
          if (!destroyed && !mainPageLoaded && origin != null) loadHome(false);
        });
      }
      @Override public void onLost(Network network) {
        runOnUiThread(() -> {
          if (!destroyed && !hasNetwork()) {
            mainPageLoaded = false;
            showConnectionError("Internet veza je prekinuta.");
            scheduleRetry();
          }
        });
      }
    };
    try { connectivity.registerDefaultNetworkCallback(networkCallback); } catch (Exception ignored) {}

    if (Build.VERSION.SDK_INT >= 33)
      getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, () -> {
        if (web.canGoBack()) web.goBack(); else finish();
      });

    origin = DEFAULT_ORIGIN.startsWith("https://") ? DEFAULT_ORIGIN : getPreferences(0).getString("server", null);
    if (origin == null && getIntent().getBooleanExtra("usb", false)) {
      origin = "http://localhost:4178";
      getPreferences(0).edit().putString("server", origin).apply();
    }
    if (origin == null) config(); else loadHome(true);
  }

  void grant() {
    if (pending == null) return;
    ArrayList<String> ok = new ArrayList<>();
    for (String r : pending.getResources())
      if ((r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == 0) ||
          (r.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && checkSelfPermission(android.Manifest.permission.CAMERA) == 0)) ok.add(r);
    if (ok.size() > 0 && same(pending.getOrigin())) pending.grant(ok.toArray(new String[0])); else pending.deny();
    pending = null;
  }

  @Override public void onRequestPermissionsResult(int c, String[] p, int[] r) {
    super.onRequestPermissionsResult(c, p, r);
    if (c == 25) grant();
  }

  @Override protected void onActivityResult(int c, int r, Intent d) {
    super.onActivityResult(c, r, d);
    if (c == 42 && files != null) {
      files.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r, d));
      files = null;
    }
  }

  @Override protected void onDestroy() {
    destroyed = true;
    if (current.get() == this) current.clear();
    cancelRetry();
    try { if (connectivity != null && networkCallback != null) connectivity.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) {}
    if (web != null) {
      web.stopLoading();
      web.removeJavascriptInterface("SFFAndroid");
      web.destroy();
    }
    super.onDestroy();
  }

  @Override public void onBackPressed() {
    if (web.canGoBack()) web.goBack(); else super.onBackPressed();
  }
}
