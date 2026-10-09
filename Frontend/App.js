import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { 
  StyleSheet, Text, View, TextInput, TouchableOpacity, Image,
  SafeAreaView, Alert, ScrollView, Modal, ActivityIndicator, Dimensions, KeyboardAvoidingView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PieChart } from 'react-native-chart-kit';
import { supabase } from './supabaseClient';

const screenWidth = Dimensions.get("window").width;
const ANALYZE_TIMEOUT_MS = 120000;
const READ_MORE_COLLAPSED_PX = 150;
const DESCRIPTION_FALLBACK =
  'Analysis based on video metadata and transcript.';

WebBrowser.maybeCompleteAuthSession();

function formatPublishDateFromPayload(data) {
  const raw = data.upload_date ?? data.publish_date ?? data.published_at;
  if (raw === undefined || raw === null || raw === '') return 'Not available';
  const s = String(raw).trim();
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return s;
}

const getBaseUrl = () => {
  if (Platform.OS === 'web') return 'http://127.0.0.1:8000';
  // Replace YOUR_COMPUTER_IP with your ipconfig IPv4 (Expo Go / physical device).
  return 'http://YOUR_COMPUTER_IP:8000';
};

function ReadMoreBox({ theme, children }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={{ width: '100%' }}>
      <View
        style={{
          maxHeight: expanded ? undefined : READ_MORE_COLLAPSED_PX,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        {children}
      </View>
      <TouchableOpacity onPress={() => setExpanded(!expanded)} style={{ marginTop: 10 }}>
        <Text style={{ color: theme.primary, fontWeight: '700' }}>
          {expanded ? 'Show less' : 'Read More'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState('Splash'); 
  const [isLogin, setIsLogin] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [secureText, setSecureText] = useState(true);
  
  // Form States
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [url, setUrl] = useState('');
  const [analysisData, setAnalysisData] = useState(null);
  const [videoMeta, setVideoMeta] = useState(null);
  const [userId, setUserId] = useState(null);
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [sessionLoading, setSessionLoading] = useState(true);
  const [processingHint, setProcessingHint] = useState('');
  const [metadataReady, setMetadataReady] = useState(false);
  const [streamAnalyzing, setStreamAnalyzing] = useState(false);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  useEffect(() => {
    const hydrateSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.log('Session restore failed:', error.message);
        } else {
          const uid = data?.session?.user?.id || null;
          setUserId(uid);
          if (uid) {
            setIsLogin(true);
            setScreen('Home');
          }
        }
      } finally {
        setSessionLoading(false);
      }
    };

    hydrateSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user?.id || null;
      setUserId((prev) => (prev === nextUserId ? prev : nextUserId));

      if (event === 'SIGNED_IN') {
        setIsLogin(true);
        setScreen((prev) => (prev === 'Auth' || prev === 'Splash' ? 'Home' : prev));
      }

      if (event === 'SIGNED_OUT') {
        setScreen((prev) => (prev === 'Home' ? 'Auth' : prev));
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const validateEmail = (value) => {
    const trimmed = value.trim();
    if (trimmed === '') {
      setEmailError('');
      return false;
    }

    const isValid = emailRegex.test(trimmed);
    setEmailError(isValid ? '' : 'Enter a valid email format (example@domain.com)');
    return isValid;
  };

  const handlePhoneChange = (value) => {
    const digitsOnly = value.replace(/\D/g, '').slice(0, 11);
    setPhone(digitsOnly);

    if (digitsOnly.length === 0) {
      setPhoneError('');
    } else if (digitsOnly.length < 11) {
      setPhoneError('Phone number must be exactly 11 digits');
    } else {
      setPhoneError('');
    }
  };

  const getPasswordStrength = (value) => {
    if (!value) return '';
    const hasMinLength = value.length >= 8;
    const hasNumber = /\d/.test(value);
    const hasLetter = /[a-zA-Z]/.test(value);

    if (hasMinLength && hasNumber && hasLetter) return 'Strong password';
    if (value.length >= 6 && (hasNumber || hasLetter)) return 'Medium password';
    return 'Weak password';
  };

  const goBack = () => {
    if (screen === 'Results') {
      setScreen('VideoData');
      return;
    }
    if (screen === 'VideoData') {
      setScreen('Home');
      return;
    }
    if (screen === 'Home') {
      setScreen('Auth');
      return;
    }
    if (screen === 'Auth') {
      setScreen('Splash');
    }
  };

  const goHome = () => {
    setScreen('Splash');
  };

  const clearAuthFields = () => {
    setEmail('');
    setPhone('');
    setPassword('');
    setConfirmPassword('');
    setEmailError('');
    setPhoneError('');
  };

  const getVideoMetaFromResponse = (data) => {
    const rawDesc = (data.video_description ?? data.description ?? '').trim();
    return {
      title: data.video_title || data.title || 'Not available',
      channel: data.channel_name || data.channel || 'Not available',
      duration: data.video_duration || data.duration || 'Not available',
      views: data.view_count ?? data.views ?? 'Not available',
      publishDate: formatPublishDateFromPayload(data),
      videoDescription: rawDesc ? rawDesc : DESCRIPTION_FALLBACK,
      foundKeywords: Array.isArray(data.found_keywords) ? data.found_keywords : [],
      thumbnailUrl: data.thumbnail_url || 'Not available',
      thumbnailOcr: data.thumbnail_ocr_text || '',
    };
  };

  const fetchWithFallback = async (path, options = {}) => {
    const baseUrl = getBaseUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  };

  const fetchAnalyzeWithFallback = async (path, body) => {
    const baseUrl = getBaseUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson, application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  };

  const consumeAnalyzeStream = async (response, { onProcessing, onMetadata, onSuccess, onError }) => {
    const decoder = new TextDecoder();
    let hadMetadata = false;
    let finalPayload = null;

    const dispatch = (o) => {
      if (o.status === 'processing' && onProcessing) onProcessing(o.message || '');
      if (o.status === 'metadata') {
        hadMetadata = true;
        onMetadata?.(o);
      }
      if (o.status === 'success') {
        finalPayload = o;
        onSuccess?.(o);
      }
      if (o.status === 'error' || o.error) {
        finalPayload = o;
        onError?.(o);
      }
    };

    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    if (!reader) {
      const text = await response.text();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          dispatch(JSON.parse(line));
        } catch {
          /* ignore */
        }
      }
      return { hadMetadata, finalPayload };
    }

    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          dispatch(JSON.parse(line));
        } catch {
          /* ignore */
        }
      }
    }
    if (buffer.trim()) {
      try {
        dispatch(JSON.parse(buffer));
      } catch {
        /* ignore */
      }
    }
    return { hadMetadata, finalPayload };
  };

  const theme = {
    bg: isDarkMode ? '#001a33' : '#f4f7fb',
    text: isDarkMode ? '#ffffff' : '#0d2847',
    inputBg: isDarkMode ? '#00264d' : '#ffffff',
    primary: isDarkMode ? '#1e5a8e' : '#0d3b66',
    chartBait: '#ff4d4d',
    chartNoBait: '#2ecc71',
    border: isDarkMode ? '#3d6a9e' : '#0d3b66',
  };

  // --- LOGIC: GO TO HOME SCREEN ---
  const handleAuth = async () => {
    // 1. Basic check to prevent empty submit
    if (email === '' || password === '') {
      Alert.alert("Input Required", "Please fill in Email and Password");
      return;
    }

    if (!validateEmail(email)) {
      return;
    }

    // 2. Signup specific check
    if (!isLogin) {
      if (phone.length !== 11) {
        setPhoneError('Phone number must be exactly 11 digits');
        return;
      }
      if (password !== confirmPassword) {
        Alert.alert("Mismatch", "Passwords do not match");
        return;
      }
    }

    setLoading(true);
    try {
      const normalizedEmail = email.trim();

      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) {
          Alert.alert('Login Error', error.message);
          return;
        }
        const resolvedUserId = data?.user?.id || null;
        if (!resolvedUserId) {
          Alert.alert('Login Error', 'Could not resolve signed-in user.');
          return;
        }
        setUserId(resolvedUserId);
        setScreen('Home');
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              phone,
            },
          },
        });
        if (error) {
          Alert.alert('Sign Up Error', error.message);
          return;
        }

        const resolvedUserId = data?.user?.id || null;
        if (resolvedUserId) {
          setUserId(resolvedUserId);
          setScreen('Home');
        } else {
          Alert.alert(
            'Check Email',
            'Signup successful. Please verify your email, then login.'
          );
          setIsLogin(true);
        }
      }
    } catch (error) {
      Alert.alert(
        'Auth Error',
        error?.message || 'Could not complete authentication.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    try {
      const nativeRedirectUri = makeRedirectUri({ scheme: 'bytethebait' });
      const redirectTo =
        Platform.OS === 'web'
          ? (typeof window !== 'undefined' ? window.location.origin : undefined)
          : nativeRedirectUri;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: Platform.OS !== 'web',
        },
      });
      if (error) {
        Alert.alert('Google Login Error', error.message);
        return;
      }

      if (Platform.OS !== 'web' && data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, nativeRedirectUri);
        if (result.type === 'success' && result.url) {
          const url = new URL(result.url.replace('#', '?'));
          const accessToken = url.searchParams.get('access_token');
          const refreshToken = url.searchParams.get('refresh_token');
          if (accessToken && refreshToken) {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (sessionError) {
              Alert.alert('Google Login Error', sessionError.message);
            }
          } else {
            Alert.alert('Google Login Error', 'No auth token was returned from Google.');
          }
        }
      }
    } catch (error) {
      Alert.alert('Google Login Error', error?.message || 'Could not start Google sign-in.');
    } finally {
      setLoading(false);
    }
  };

  // --- LOGIC: ANALYZE ---
  const startAnalysis = async () => {
    if (sessionLoading) {
      Alert.alert("Please Wait", "Restoring your session. Try again in a moment.");
      return;
    }

    if (!userId) {
      Alert.alert("Session Required", "Please login again before analyzing a video.");
      return;
    }

    if (!url.includes('youtube') && !url.includes('youtu.be')) {
      Alert.alert("URL Error", "Please paste a valid YouTube link");
      return;
    }

    setMetadataReady(false);
    setVideoMeta(null);
    setAnalysisData(null);
    setStreamAnalyzing(false);

    setLoading(true);
    setProcessingHint('Connecting…');
    try {
      const response = await fetchAnalyzeWithFallback('/analyze', {
        url: url.trim(),
        user_id: userId,
      });

      if (!response.ok) {
        let msg = `HTTP ${response.status}`;
        try {
          const t = await response.text();
          if (t) msg = t;
        } catch {
          /* ignore */
        }
        Alert.alert('Analyze Error', String(msg));
        return;
      }

      setStreamAnalyzing(true);
      const { hadMetadata, finalPayload } = await consumeAnalyzeStream(response, {
        onProcessing: (msg) => setProcessingHint(msg || ''),
        onMetadata: (o) => {
          setVideoMeta(getVideoMetaFromResponse(o));
          setMetadataReady(true);
          setAnalysisData({
            isPending: true,
            baitScore: null,
            noBaitScore: null,
            clickbait_percentage: null,
            video_title: o.video_title || o.title || '',
            foundKeywords: [],
          });
          setScreen('VideoData');
          setLoading(false);
        },
        onSuccess: (o) => {
          const pct = Number(o.clickbait_percentage ?? 0);
          setAnalysisData((prev) => ({
            ...(prev || {}),
            baitScore: pct,
            noBaitScore: 100 - pct,
            clickbait_percentage: pct,
            video_title: o.video_title || prev?.video_title || '',
            foundKeywords: Array.isArray(o.found_keywords)
              ? o.found_keywords
              : prev?.foundKeywords || [],
            isPending: false,
          }));
          setVideoMeta((prev) => {
            const patch = getVideoMetaFromResponse(o);
            const base = { ...(prev || {}), ...patch };
            const hasDateField =
              (o.upload_date != null && o.upload_date !== '') ||
              (o.publish_date != null && o.publish_date !== '') ||
              (o.published_at != null && o.published_at !== '');
            if (!hasDateField && prev?.publishDate && prev.publishDate !== 'Not available') {
              base.publishDate = prev.publishDate;
            }
            const hasDesc = String(o.video_description ?? o.description ?? '').trim();
            if (!hasDesc && prev?.videoDescription) {
              base.videoDescription = prev.videoDescription;
            }
            return base;
          });
        },
        onError: (o) => {
          const msg =
            o?.message ||
            o?.error ||
            (Array.isArray(o?.detail) && o.detail[0]?.msg) ||
            o?.detail ||
            'Could not analyze this video right now.';
          Alert.alert('Analyze Error', String(msg));
        },
      });

      if (!hadMetadata) {
        Alert.alert(
          'Analyze Error',
          'No video metadata was received. Check the backend and your network connection.'
        );
      } else if (finalPayload && finalPayload.status !== 'success' && !finalPayload.error) {
        /* stream ended without explicit success; onError may have fired */
      }
    } catch (error) {
      Alert.alert(
        'Server Error',
        `Backend is not responding on /analyze (Whisper/OCR can take up to 2 minutes). Base URL: ${getBaseUrl()}\n\n${error?.message || ''}`
      );
    } finally {
      setLoading(false);
      setProcessingHint('');
      setStreamAnalyzing(false);
    }
  };

  if (sessionLoading) {
    return (
      <SafeAreaView style={[styles.main, { backgroundColor: isDarkMode ? '#001a33' : '#f4f7fb' }]}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={isDarkMode ? '#1e5a8e' : '#0d3b66'} />
          <Text style={{ marginTop: 12, color: isDarkMode ? '#ffffff' : '#0d2847' }}>
            Restoring session...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.main, { backgroundColor: theme.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{flex: 1}}>
        
        {/* HEADER */}
        {screen !== 'Splash' && (
          <View style={styles.header}>
            <View style={styles.headerLeftGroup}>
              <TouchableOpacity onPress={goBack} style={styles.headerIconBtn}>
                <Ionicons name="arrow-back" size={22} color={theme.text} />
              </TouchableOpacity>
              <TouchableOpacity onPress={goHome} style={styles.headerIconBtn}>
                <Ionicons name="home-outline" size={22} color={theme.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.headerBrand}>
              <Image source={require('./assets/images/logo.png')} style={styles.headerLogo} resizeMode="contain" />
              <Text style={[styles.logoText, { color: theme.text }]}>ByteTheBait</Text>
            </View>
            <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.headerIconBtn}>
              <Ionicons name="ellipsis-vertical" size={22} color={theme.text} />
            </TouchableOpacity>
          </View>
        )}

        {/* SCREEN 0: SPLASH */}
        {screen === 'Splash' && (
          <View style={styles.splashContainer}>
            <Image source={require('./assets/images/logo.png')} style={styles.splashLogoImage} resizeMode="contain" />
            <Text style={[styles.splashTitle, { color: theme.text }]}>ByteTheBait</Text>
            <Text style={[styles.splashSubtitle, { color: theme.text }]}>Detect clickbait smarter</Text>
            <View style={styles.splashButtonGroup}>
              <TouchableOpacity
                style={[styles.splashButton, { backgroundColor: theme.primary }]}
                onPress={() => {
                  setIsLogin(true);
                  setScreen('Auth');
                }}
              >
                <Text style={styles.buttonText}>Login</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.splashButton, styles.splashSecondaryButton, { borderColor: theme.primary }]}
                onPress={() => {
                  setIsLogin(false);
                  setScreen('Auth');
                }}
              >
                <Text style={[styles.buttonText, { color: theme.primary }]}>Sign Up</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* SCREEN 1: AUTHENTICATION */}
        {screen === 'Auth' && (
          <ScrollView contentContainerStyle={styles.centerContainer} keyboardShouldPersistTaps="handled">
            <Ionicons name="shield-checkmark" size={80} color={theme.text} style={{marginBottom: 10}} />
            <Text style={[styles.title, { color: theme.text }]}>{isLogin ? 'Welcome Back' : 'Create Account'}</Text>
            
            <TextInput 
              style={[styles.input, { color: theme.text, backgroundColor: theme.inputBg, borderColor: theme.border }]} 
              placeholder="Email" placeholderTextColor="#999" value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (emailError) validateEmail(value);
              }}
              onBlur={() => validateEmail(email)}
            />
            {!!emailError && <Text style={styles.errorText}>{emailError}</Text>}
            
            {!isLogin && (
              <>
                <TextInput 
                  style={[styles.input, { color: theme.text, backgroundColor: theme.inputBg, borderColor: theme.border, marginTop: 15 }]} 
                  placeholder="Phone Number" placeholderTextColor="#999" value={phone}
                  onChangeText={handlePhoneChange} keyboardType="numeric"
                  maxLength={11}
                />
                {!!phoneError && <Text style={styles.errorText}>{phoneError}</Text>}
              </>
            )}

            <View style={[styles.passwordContainer, { backgroundColor: theme.inputBg, borderColor: theme.border, marginTop: 15 }]}>
              <TextInput 
                style={{ flex: 1, color: theme.text, height: 50, paddingHorizontal: 15 }} 
                placeholder="Password" secureTextEntry={secureText} placeholderTextColor="#999" value={password} onChangeText={setPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setSecureText(!secureText)} style={{ paddingRight: 15 }}>
                <Ionicons name={secureText ? "eye-off" : "eye"} size={22} color={theme.text} />
              </TouchableOpacity>
            </View>
            {!isLogin && !!password && (
              <Text style={[styles.passwordHint, { color: theme.text }]}>
                {getPasswordStrength(password)}
              </Text>
            )}

            {!isLogin && (
              <TextInput 
                style={[styles.input, { color: theme.text, backgroundColor: theme.inputBg, borderColor: theme.border, marginTop: 15 }]} 
                placeholder="Confirm Password" secureTextEntry={secureText} placeholderTextColor="#999" value={confirmPassword} onChangeText={setConfirmPassword} 
              />
            )}

            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: theme.primary, marginTop: 30 }]} onPress={handleAuth}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{isLogin ? 'Login' : 'Sign Up'}</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.googleButton, { borderColor: theme.border, backgroundColor: theme.inputBg }]}
              onPress={handleGoogleAuth}
            >
              <Ionicons name="logo-google" size={20} color={theme.text} />
              <Text style={[styles.googleButtonText, { color: theme.text }]}>Continue with Google</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setIsLogin(!isLogin)} style={{marginTop: 20}}>
              <Text style={{color: theme.text, fontWeight: 'bold'}}>{isLogin ? "Need an account? Sign Up" : "Have an account? Login"}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* SCREEN 2: HOME (INPUT URL) */}
        {screen === 'Home' && (
          <View style={styles.centerContainer}>
            <Ionicons name="link-outline" size={80} color={theme.text} />
            <Text style={[styles.title, { color: theme.text, marginTop: 10 }]}>Paste Link</Text>
            <TextInput 
              style={[styles.input, { color: theme.text, backgroundColor: theme.inputBg, borderColor: theme.border }]} 
              placeholder="https://youtube.com/..." placeholderTextColor="#999" value={url} onChangeText={setUrl}
            />
            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: theme.primary, marginTop: 20 }]} onPress={startAnalysis}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Analyse Now</Text>}
            </TouchableOpacity>
            {loading && !!processingHint && (
              <Text style={{ marginTop: 14, color: theme.text, textAlign: 'center', fontSize: 14, lineHeight: 20, paddingHorizontal: 8 }}>
                {processingHint}
              </Text>
            )}
            <TouchableOpacity onPress={() => setScreen('Auth')} style={{marginTop: 20}}>
              <Text style={{color: theme.text}}>Back to Login</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* SCREEN 3: VIDEO DATA */}
        {screen === 'VideoData' && videoMeta && (
          <ScrollView contentContainerStyle={styles.centerContainer}>
            <Text style={[styles.title, { color: theme.text }]}>Fetched Video Data</Text>
            {streamAnalyzing && (
              <Text style={[styles.streamHint, { color: theme.text }]}>
                Refining analysis in the background… You can open results when ready.
              </Text>
            )}
            <View style={[styles.metaCard, { backgroundColor: theme.inputBg, borderColor: theme.border }]}>
              <Text style={[styles.metaLabel, { color: theme.text }]}>Title</Text>
              <Text style={[styles.metaValue, { color: theme.text }]}>{videoMeta.title}</Text>

              <Text style={[styles.metaLabel, { color: theme.text }]}>Channel</Text>
              <Text style={[styles.metaValue, { color: theme.text }]}>{videoMeta.channel}</Text>

              <Text style={[styles.metaLabel, { color: theme.text }]}>Duration</Text>
              <Text style={[styles.metaValue, { color: theme.text }]}>{videoMeta.duration}</Text>

              <Text style={[styles.metaLabel, { color: theme.text }]}>Views</Text>
              <Text style={[styles.metaValue, { color: theme.text }]}>{String(videoMeta.views)}</Text>

              <Text style={[styles.metaLabel, { color: theme.text }]}>Publish Date</Text>
              <Text style={[styles.metaValue, { color: theme.text }]}>{videoMeta.publishDate}</Text>

              {!!videoMeta.thumbnailOcr && (
                <>
                  <Text style={[styles.metaLabel, { color: theme.text }]}>Thumbnail OCR</Text>
                  <Text style={[styles.metaValue, { color: theme.text }]} selectable>{videoMeta.thumbnailOcr}</Text>
                </>
              )}

              <Text style={[styles.metaLabel, { color: theme.text }]}>Video Description</Text>
              <ReadMoreBox theme={theme}>
                <Text style={[styles.metaValue, { color: theme.text, textAlign: 'left' }]} selectable>
                  {videoMeta.videoDescription}
                </Text>
              </ReadMoreBox>

              {!!videoMeta.foundKeywords?.length && (
                <>
                  <Text style={[styles.metaLabel, { color: theme.text }]}>Bait keywords detected</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {videoMeta.foundKeywords.map((kw) => (
                      <View key={kw} style={[styles.keywordChip, { borderColor: '#e63946' }]}>
                        <Text style={{ color: '#e63946', fontSize: 12, fontWeight: '700' }}>{kw}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

            </View>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                {
                  backgroundColor: theme.primary,
                  marginTop: 20,
                  opacity: metadataReady ? 1 : 0.45,
                },
              ]}
              disabled={!metadataReady}
              onPress={() => setScreen('Results')}
            >
              <Text style={styles.buttonText}>View Analysis Result</Text>
            </TouchableOpacity>
            {!metadataReady && (
              <Text style={[styles.streamHint, { color: theme.text, marginTop: 10 }]}>
                Waiting for video metadata from the server…
              </Text>
            )}
          </ScrollView>
        )}

        {/* SCREEN 4: RESULTS */}
        {screen === 'Results' && analysisData && (
          <ScrollView contentContainerStyle={styles.centerContainer}>
            <Text style={[styles.title, { color: theme.text }]}>Results</Text>
            <View style={[styles.metaCard, { backgroundColor: theme.inputBg, borderColor: theme.border, marginBottom: 16 }]}>
              <Text style={[styles.metaLabel, { color: theme.text }]}>Video title</Text>
              <Text style={[styles.metaValue, { color: theme.text, fontWeight: '700' }]}>
                {analysisData.video_title || videoMeta?.title || '—'}
              </Text>
              {!!videoMeta && (
                <>
                  <Text style={[styles.metaLabel, { color: theme.text }]}>Channel</Text>
                  <Text style={[styles.metaValue, { color: theme.text }]}>{videoMeta.channel}</Text>
                  <Text style={[styles.metaLabel, { color: theme.text }]}>Views</Text>
                  <Text style={[styles.metaValue, { color: theme.text }]}>{String(videoMeta.views)}</Text>
                </>
              )}
            </View>
            {!!analysisData.foundKeywords?.length && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12, justifyContent: 'center' }}>
                {analysisData.foundKeywords.map((kw) => (
                  <View key={kw} style={[styles.keywordChip, { borderColor: theme.primary }]}>
                    <Text style={{ color: theme.primary, fontSize: 12, fontWeight: '700' }}>{kw}</Text>
                  </View>
                ))}
              </View>
            )}
            {analysisData.isPending ? (
              <View style={styles.spinnerSection}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={[styles.spinnerCaption, { color: theme.text }]}>
                  Computing clickbait score… This can take up to 2 minutes while transcription runs.
                </Text>
              </View>
            ) : (
              <>
                {(() => {
                  const score = Number(
                    analysisData.clickbait_percentage ?? analysisData.baitScore ?? 0
                  );
                  const high = score > 50;
                  const mainColor = high ? '#e63946' : '#2ecc71';
                  const restColor = '#cfd8e3';
                  return (
                    <>
                      <PieChart
                        data={[
                          { name: 'Clickbait', population: score, color: mainColor },
                          { name: 'Rest', population: Math.max(0, 100 - score), color: restColor },
                        ]}
                        width={screenWidth}
                        height={220}
                        chartConfig={{
                          color: (opacity = 1) => `rgba(13, 59, 102, ${opacity})`,
                        }}
                        accessor="population"
                        backgroundColor="transparent"
                        paddingLeft="0"
                        center={[screenWidth / 4, 10]}
                        hasLegend={false}
                      />
                      <View style={styles.legendContainer}>
                        <Text style={[styles.legendText, { color: mainColor }]}>
                          {score}% clickbait signal
                        </Text>
                        <Text style={[styles.legendSub, { color: theme.text }]}>
                          {high ? 'Elevated mismatch risk' : 'Lower mismatch risk'}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.verdictCard,
                          { backgroundColor: theme.inputBg, borderColor: theme.border },
                        ]}
                      >
                        <Text style={[styles.verdictHeading, { color: theme.primary }]}>
                          Analysis Verdict
                        </Text>
                        <Text style={[styles.verdictLine, { color: theme.text }]}>
                          {high
                            ? 'Verdict: POTENTIAL CLICKBAIT. Reasoning: The video content significantly differs from the sensationalized title keywords.'
                            : 'Verdict: AUTHENTIC CONTENT. Reasoning: The spoken content closely aligns with the title and metadata provided.'}
                        </Text>
                      </View>
                    </>
                  );
                })()}
              </>
            )}

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: theme.primary, marginTop: 30 }]}
              onPress={() => {
                setMetadataReady(false);
                setVideoMeta(null);
                setAnalysisData(null);
                setUrl('');
                setScreen('Home');
              }}
            >
              <Text style={styles.buttonText}>Try New Video</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* SCREEN 5: ABOUT */}
        {screen === 'About' && (
          <ScrollView contentContainerStyle={styles.centerContainer}>
            <Text style={[styles.title, { color: theme.text }]}>About ByteTheBait</Text>
            <View style={[styles.aboutCard, { backgroundColor: theme.inputBg, borderColor: theme.border }]}>
              <Text style={[styles.aboutHeading, { color: theme.text }]}>Project: ByteTheBait</Text>
              <Text style={[styles.aboutBody, { color: theme.text }]}>Domain: Artificial Intelligence & Web Transparency</Text>
              <Text style={[styles.aboutBody, { color: theme.text }]}>
                In an era of information overload, ByteTheBait serves as a digital shield against sensationalism.
                Developed by Mahnoor Irfan and Naima Gul under the expert supervision of Sir Farman Ali Marwat,
                this project utilizes Machine Learning to evaluate the consistency between video titles and transcripts.
                Our mission is to promote transparency in digital media and save users from the clickbait trap.
              </Text>
            </View>
          </ScrollView>
        )}

        {/* SETTINGS MODAL */}
        <Modal transparent visible={showSettings} animationType="fade">
          <TouchableOpacity style={styles.modalOverlay} onPress={() => setShowSettings(false)}>
            <View style={[styles.settingsBox, { backgroundColor: theme.bg, borderColor: theme.border, borderWidth: 1 }]}>
              <TouchableOpacity style={styles.settingItem} onPress={() => { setIsDarkMode(!isDarkMode); setShowSettings(false); }}>
                <Ionicons name={isDarkMode ? "sunny" : "moon"} size={20} color={theme.text} />
                <Text style={[styles.settingText, { color: theme.text }]}>{isDarkMode ? " Light Mode" : " Dark Mode"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.settingItem}
                onPress={() => {
                  clearAuthFields();
                  setUrl('');
                  setAnalysisData(null);
                  setVideoMeta(null);
                  setMetadataReady(false);
                  setStreamAnalyzing(false);
                  setShowSettings(false);
                  Alert.alert("Cleared", "All form data has been cleared.");
                }}
              >
                <Ionicons name="trash-outline" size={20} color={theme.text} />
                <Text style={[styles.settingText, { color: theme.text }]}> Clear Fields</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.settingItem}
                onPress={async () => {
                  setLoading(true);
                  try {
                    await supabase.auth.signOut();
                  } catch (_) {
                    // Ignore sign-out cleanup failures and continue local reset.
                  } finally {
                    setUserId(null);
                    clearAuthFields();
                    setUrl('');
                    setAnalysisData(null);
                    setVideoMeta(null);
                    setMetadataReady(false);
                    setStreamAnalyzing(false);
                    setShowSettings(false);
                    setIsLogin(false);
                    setScreen('Auth');
                    setLoading(false);
                  }
                }}
              >
                <Ionicons name="log-out-outline" size={20} color={theme.text} />
                <Text style={[styles.settingText, { color: theme.text }]}> Logout</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.settingItem}
                onPress={() => {
                  setShowSettings(false);
                  setScreen('About');
                }}
              >
                <Ionicons name="information-circle-outline" size={20} color={theme.text} />
                <Text style={[styles.settingText, { color: theme.text }]}> About App</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  main: { flex: 1 },
  header: { height: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14 },
  headerLeftGroup: { flexDirection: 'row', alignItems: 'center' },
  headerIconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  headerBrand: { flexDirection: 'row', alignItems: 'center' },
  headerLogo: { width: 38, height: 38, marginRight: 10, borderRadius: 6 },
  splashContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  splashLogoImage: { width: 240, height: 240, marginBottom: 16 },
  splashTitle: { fontSize: 32, fontWeight: 'bold', letterSpacing: 0.4 },
  splashSubtitle: { fontSize: 14, marginTop: 10, opacity: 0.75, fontWeight: '600' },
  splashButtonGroup: { marginTop: 30, width: '80%', gap: 12 },
  splashButton: { width: '100%', height: 52, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  splashSecondaryButton: { borderWidth: 1.5, backgroundColor: 'transparent' },
  centerContainer: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  logoText: { fontSize: 18, fontWeight: 'bold' },
  input: { width: '100%', height: 50, borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 15, fontSize: 16 },
  passwordContainer: { width: '100%', height: 50, borderRadius: 10, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center' },
  primaryButton: { width: '100%', height: 55, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 18, fontWeight: 'bold' },
  legendContainer: { marginVertical: 10, alignItems: 'center' },
  legendText: { fontSize: 18, fontWeight: 'bold', marginVertical: 4 },
  legendSub: { fontSize: 14, fontWeight: '600', opacity: 0.85 },
  streamHint: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 12, opacity: 0.9 },
  spinnerSection: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 260,
    paddingVertical: 24,
  },
  spinnerCaption: {
    marginTop: 16,
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: 12,
  },
  verdictCard: {
    marginTop: 20,
    width: '100%',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  verdictHeading: { fontSize: 17, fontWeight: '800', marginBottom: 10 },
  verdictLine: { fontSize: 15, lineHeight: 23, fontWeight: '500' },
  metaCard: { width: '100%', borderWidth: 1, borderRadius: 12, padding: 14 },
  metaLabel: { fontSize: 13, fontWeight: '700', marginTop: 10, opacity: 0.9 },
  metaValue: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  keywordChip: {
    borderWidth: 1.2,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  aboutCard: { width: '100%', borderWidth: 1, borderRadius: 12, padding: 16 },
  aboutHeading: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  aboutBody: { fontSize: 14, lineHeight: 23, marginBottom: 10 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  settingsBox: { position: 'absolute', top: 60, right: 16, width: 210, padding: 10, borderRadius: 10 },
  settingItem: { flexDirection: 'row', alignItems: 'center', padding: 10 },
  settingText: { fontSize: 16, fontWeight: 'bold' },
  errorText: { color: '#ff4d4d', fontSize: 12, alignSelf: 'flex-start', marginTop: 6, marginLeft: 2 },
  googleButton: { marginTop: 14, width: '100%', height: 52, borderRadius: 10, borderWidth: 1.2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  googleButtonText: { marginLeft: 8, fontSize: 16, fontWeight: '600' },
  passwordHint: { fontSize: 12, alignSelf: 'flex-start', marginTop: 8, opacity: 0.8 }
});