import React, { useState } from 'react';
import { 
  StyleSheet, Text, View, TextInput, TouchableOpacity, 
  SafeAreaView, Alert, ScrollView, Modal, ActivityIndicator, Dimensions, KeyboardAvoidingView, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PieChart } from 'react-native-chart-kit';

const screenWidth = Dimensions.get("window").width;
const API_BASE_URL = 'http://127.0.0.1:8000';

export default function App() {
  const [screen, setScreen] = useState('Auth'); 
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

  const theme = {
    bg: isDarkMode ? '#001a33' : '#ffffff',
    text: isDarkMode ? '#ffffff' : '#003366',
    inputBg: isDarkMode ? '#00264d' : '#f9f9f9',
    primary: isDarkMode ? '#004080' : '#003366',
    chartBait: '#ff4d4d',
    chartNoBait: '#2ecc71',
    border: isDarkMode ? '#ffffff' : '#003366'
  };

  // --- LOGIC: GO TO HOME SCREEN ---
  const handleAuth = () => {
    // 1. Basic check to prevent empty submit
    if (email === '' || password === '') {
      Alert.alert("Input Required", "Please fill in Email and Password");
      return;
    }

    // 2. Signup specific check
    if (!isLogin) {
      if (phone.length < 10) {
        Alert.alert("Invalid Phone", "Please enter a valid phone number");
        return;
      }
      if (password !== confirmPassword) {
        Alert.alert("Mismatch", "Passwords do not match");
        return;
      }
    }

    // 3. FORCE SCREEN CHANGE
    console.log("Switching to Home Screen...");
    setScreen('Home');
  };

  // --- LOGIC: ANALYZE ---
  const startAnalysis = async () => {
    if (!url.includes('youtube') && !url.includes('youtu.be')) {
      Alert.alert("URL Error", "Please paste a valid YouTube link");
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_url: url }),
      });

      const data = await response.json();
      
      setAnalysisData({
        baitScore: data.clickbait_percentage || 0,
        noBaitScore: 100 - (data.clickbait_percentage || 0),
        description: data.reasoning || "Analysis complete."
      });

      setScreen('Results');
    } catch (error) {
      Alert.alert("Server Error", "Backend is not responding. Check your Python terminal.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.main, { backgroundColor: theme.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{flex: 1}}>
        
        {/* HEADER */}
        <View style={styles.header}>
          <Text style={[styles.logoText, { color: theme.text }]}>ByteTheBait</Text>
          <TouchableOpacity onPress={() => setShowSettings(true)}>
            <Ionicons name="ellipsis-vertical" size={24} color={theme.text} />
          </TouchableOpacity>
        </View>

        {/* SCREEN 1: AUTHENTICATION */}
        {screen === 'Auth' && (
          <ScrollView contentContainerStyle={styles.centerContainer} keyboardShouldPersistTaps="handled">
            <Ionicons name="shield-checkmark" size={80} color={theme.text} style={{marginBottom: 10}} />
            <Text style={[styles.title, { color: theme.text }]}>{isLogin ? 'Welcome Back' : 'Create Account'}</Text>
            
            <TextInput 
              style={[styles.input, { color: theme.text, backgroundColor: theme.inputBg, borderColor: theme.border }]} 
              placeholder="Email" placeholderTextColor="#999" value={email} onChangeText={setEmail}
            />
            
            {!isLogin && (
              <TextInput 
                style={[styles.input, { color: theme.text, backgroundColor: theme.inputBg, borderColor: theme.border, marginTop: 15 }]} 
                placeholder="Phone Number" placeholderTextColor="#999" value={phone} onChangeText={setPhone} keyboardType="numeric"
              />
            )}

            <View style={[styles.passwordContainer, { backgroundColor: theme.inputBg, borderColor: theme.border, marginTop: 15 }]}>
              <TextInput 
                style={{ flex: 1, color: theme.text, height: 50, paddingHorizontal: 15 }} 
                placeholder="Password" secureTextEntry={secureText} placeholderTextColor="#999" value={password} onChangeText={setPassword} 
              />
              <TouchableOpacity onPress={() => setSecureText(!secureText)} style={{ paddingRight: 15 }}>
                <Ionicons name={secureText ? "eye-off" : "eye"} size={22} color={theme.text} />
              </TouchableOpacity>
            </View>

            {!isLogin && (
              <TextInput 
                style={[styles.input, { color: theme.text, backgroundColor: theme.inputBg, borderColor: theme.border, marginTop: 15 }]} 
                placeholder="Confirm Password" secureTextEntry={secureText} placeholderTextColor="#999" value={confirmPassword} onChangeText={setConfirmPassword} 
              />
            )}

            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: theme.primary, marginTop: 30 }]} onPress={handleAuth}>
              <Text style={styles.buttonText}>{isLogin ? 'Login' : 'Sign Up'}</Text>
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
            <TouchableOpacity onPress={() => setScreen('Auth')} style={{marginTop: 20}}>
              <Text style={{color: theme.text}}>Back to Login</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* SCREEN 3: RESULTS */}
        {screen === 'Results' && analysisData && (
          <ScrollView contentContainerStyle={styles.centerContainer}>
            <Text style={[styles.title, { color: theme.text }]}>Results</Text>
            <PieChart
              data={[
                { name: "Bait", population: analysisData.baitScore, color: theme.chartBait },
                { name: "Clean", population: analysisData.noBaitScore, color: theme.chartNoBait },
              ]} 
              width={screenWidth} height={200}
              chartConfig={{ color: (opacity = 1) => `rgba(0,0,0, ${opacity})` }}
              accessor={"population"} backgroundColor={"transparent"} paddingLeft={"0"}
              center={[screenWidth / 4, 0]} hasLegend={false}
            />
            <View style={styles.legendContainer}>
              <Text style={[styles.legendText, { color: theme.chartBait }]}>● {analysisData.baitScore}% Clickbait</Text>
              <Text style={[styles.legendText, { color: theme.chartNoBait }]}>● {analysisData.noBaitScore}% Clean</Text>
            </View>
            <View style={[styles.descBox, { backgroundColor: theme.inputBg, borderColor: theme.border, borderWidth: 1 }]}>
              <Text style={[styles.descText, { color: theme.text }]}>{analysisData.description}</Text>
            </View>
            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: theme.primary, marginTop: 30 }]} onPress={() => setScreen('Home')}>
              <Text style={styles.buttonText}>Try New Video</Text>
            </TouchableOpacity>
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
            </View>
          </TouchableOpacity>
        </Modal>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  main: { flex: 1 },
  header: { height: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  centerContainer: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  logoText: { fontSize: 18, fontWeight: 'bold' },
  input: { width: '100%', height: 50, borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 15, fontSize: 16 },
  passwordContainer: { width: '100%', height: 50, borderRadius: 10, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center' },
  primaryButton: { width: '100%', height: 55, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 18, fontWeight: 'bold' },
  legendContainer: { marginVertical: 10, alignItems: 'center' },
  legendText: { fontSize: 18, fontWeight: 'bold', marginVertical: 4 },
  descBox: { marginTop: 20, padding: 15, borderRadius: 10, width: '100%' },
  descText: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  settingsBox: { position: 'absolute', top: 60, right: 20, width: 160, padding: 10, borderRadius: 10 },
  settingItem: { flexDirection: 'row', alignItems: 'center', padding: 10 },
  settingText: { fontSize: 16, fontWeight: 'bold' }
});