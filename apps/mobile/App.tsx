import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const supabase = url && anon ? createClient(url, anon, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
}) : null;
const bg = '#100d2b';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [services, setServices] = useState<{service:string;credit_cost:number}[]>([]);
  const [projects, setProjects] = useState<{id:string;title:string;status:string}[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({data}) => setSession(data.session));
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session && supabase) void loadData();
  }, [session]);
  async function loadData() {
    if (!supabase || !session) return;
    const [wallet, svc, projs] = await Promise.all([
      supabase.from('wallets').select('balance').eq('user_id', session.user.id).maybeSingle(),
      supabase.from('service_settings').select('service,credit_cost').eq('enabled', true),
      supabase.from('projects').select('id,title,status').eq('user_id', session.user.id).order('created_at',{ascending:false}).limit(10)
    ]);
    if (wallet.error || svc.error || projs.error) Alert.alert('تعذر تحميل البيانات', wallet.error?.message || svc.error?.message || projs.error?.message);
    setBalance(wallet.data?.balance ?? null);
    setServices(svc.data ?? []);
    setProjects(projs.data ?? []);
  }
  async function sendCode() {
    if (!supabase) return;
    setBusy(true);
    const {error} = await supabase.auth.signInWithOtp({email:email.trim(), options:{shouldCreateUser:true}});
    setBusy(false);
    if (error) Alert.alert('تعذر إرسال الرمز', error.message); else setSent(true);
  }
  async function verifyCode() {
    if (!supabase) return;
    setBusy(true);
    const {error} = await supabase.auth.verifyOtp({email:email.trim(), token:otp.trim(), type:'email'});
    setBusy(false);
    if (error) Alert.alert('تعذر التحقق', error.message);
  }
  if (!supabase) return <SafeAreaView style={styles.page}><StatusBar style="light"/><Text style={styles.title}>JAMIL AI</Text><Text style={styles.text}>أضف EXPO_PUBLIC_SUPABASE_URL وEXPO_PUBLIC_SUPABASE_ANON_KEY في ملف البيئة المحلي للبدء.</Text></SafeAreaView>;
  if (!session) return <SafeAreaView style={styles.page}><StatusBar style="light"/><Text style={styles.title}>JAMIL AI</Text><Text style={styles.text}>سجّل الدخول إلى حسابك</Text><TextInput autoCapitalize="none" keyboardType="email-address" placeholder="البريد الإلكتروني" placeholderTextColor="#9e9ab7" value={email} onChangeText={setEmail} style={styles.input}/>{sent && <TextInput keyboardType="number-pad" placeholder="رمز التحقق" placeholderTextColor="#9e9ab7" value={otp} onChangeText={setOtp} style={styles.input}/>}<TouchableOpacity style={styles.button} onPress={sent?verifyCode:sendCode} disabled={busy}><Text style={styles.buttonText}>{busy?'جارٍ التنفيذ…':sent?'تحقق':'إرسال رمز الدخول'}</Text></TouchableOpacity></SafeAreaView>;
  return <SafeAreaView style={styles.page}><StatusBar style="light"/><ScrollView><View style={styles.row}><Text style={styles.title}>JAMIL AI</Text><TouchableOpacity onPress={()=>supabase.auth.signOut()}><Text style={styles.link}>تسجيل الخروج</Text></TouchableOpacity></View><Text style={styles.text}>{session.user.email}</Text><View style={styles.card}><Text style={styles.label}>الرصيد</Text><Text style={styles.amount}>{balance===null?'—':balance}</Text></View><Text style={styles.heading}>الخدمات المتاحة</Text>{services.length?services.map(s=><View key={s.service} style={styles.item}><Text style={styles.text}>{s.service}</Text><Text style={styles.muted}>{s.credit_cost} رصيد</Text></View>):<Text style={styles.muted}>لا توجد خدمات مفعّلة حاليًا.</Text>}<Text style={styles.heading}>مشاريعي</Text>{projects.length?projects.map(p=><View key={p.id} style={styles.item}><Text style={styles.text}>{p.title}</Text><Text style={styles.muted}>{p.status}</Text></View>):<Text style={styles.muted}>لا توجد مشاريع بعد.</Text>}<TouchableOpacity style={styles.button} onPress={loadData}><Text style={styles.buttonText}>تحديث</Text></TouchableOpacity></ScrollView></SafeAreaView>;
}
const styles:any={page:{flex:1,backgroundColor:bg,padding:22,paddingTop:46},title:{fontSize:28,fontWeight:'800',color:'#fff',marginBottom:12},text:{fontSize:16,color:'#f2efff',marginBottom:12},muted:{fontSize:14,color:'#aaa5c5'},label:{fontSize:15,color:'#c9c4df'},amount:{fontSize:34,fontWeight:'700',color:'#1de6ff'},heading:{fontSize:20,fontWeight:'700',color:'#fff',marginTop:28,marginBottom:10},card:{backgroundColor:'#211b43',borderRadius:18,padding:20,marginTop:18},row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},item:{backgroundColor:'#211b43',borderRadius:12,padding:14,marginVertical:5,flexDirection:'row',justifyContent:'space-between'},input:{backgroundColor:'#211b43',borderRadius:12,padding:14,color:'#fff',marginVertical:8},button:{backgroundColor:'#7047ff',padding:15,borderRadius:12,alignItems:'center',marginTop:14},buttonText:{color:'#fff',fontWeight:'700',fontSize:16},link:{color:'#1de6ff'}};
