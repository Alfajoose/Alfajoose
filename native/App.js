import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  StyleSheet,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import html from './src/frameTwelveHtml';
import downloadBridge from './src/downloadBridge';

// Frame Twelve keeps projects in IndexedDB and localStorage. Both need a real
// origin: loaded from file:// the storage is either opaque or unavailable, and
// saved work would silently vanish between launches. Giving the WebView a
// baseUrl gives the page a stable origin to key that storage against.
const ORIGIN = 'https://frametwelve.local';

export default function App() {
  const webRef = useRef(null);
  const canGoBack = useRef(false);
  const [loading, setLoading] = useState(true);

  // Android hardware back: let the page handle history first.
  const onAndroidBack = useCallback(() => {
    if (canGoBack.current && webRef.current) {
      webRef.current.goBack();
      return true;
    }
    return false;
  }, []);

  const onNavStateChange = useCallback(
    (nav) => {
      canGoBack.current = nav.canGoBack;
      BackHandler.removeEventListener?.('hardwareBackPress', onAndroidBack);
      BackHandler.addEventListener?.('hardwareBackPress', onAndroidBack);
    },
    [onAndroidBack]
  );

  const onMessage = useCallback(async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return; // not ours
    }

    if (msg.type === 'error') {
      Alert.alert('Frame Twelve', msg.message || 'Something went wrong.');
      return;
    }

    if (msg.type !== 'save-file') return;

    try {
      // Strip anything that would be illegal in a filename.
      const safe = String(msg.filename || 'export').replace(/[^\w.\-]+/g, '_');
      const uri = FileSystem.cacheDirectory + safe;

      await FileSystem.writeAsStringAsync(uri, msg.base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: msg.mime,
          dialogTitle: safe,
        });
      } else {
        Alert.alert('Saved', `Written to:\n${uri}`);
      }
    } catch (err) {
      Alert.alert('Export failed', String(err?.message ?? err));
    }
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <WebView
        ref={webRef}
        style={styles.web}
        source={{ html, baseUrl: ORIGIN }}
        originWhitelist={['*']}
        injectedJavaScriptBeforeContentLoaded={downloadBridge}
        onMessage={onMessage}
        onNavigationStateChange={onNavStateChange}
        onLoadEnd={() => setLoading(false)}
        // Drawing app: none of the browser chrome behaviours are wanted.
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        overScrollMode="never"
        bounces={false}
        scrollEnabled={false}
        setBuiltInZoomControls={false}
        textZoom={100}
        androidLayerType="hardware"
        onRenderProcessGone={() => {
          Alert.alert(
            'Frame Twelve',
            'The drawing engine ran out of memory and restarted.'
          );
          webRef.current?.reload();
        }}
      />
      {loading && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator size="large" color="#2d52b8" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1115' },
  web: { flex: 1, backgroundColor: '#0f1115' },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f1115',
  },
});
