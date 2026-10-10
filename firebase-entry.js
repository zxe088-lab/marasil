// نسخة Firebase المحلية لتطبيق الآيفون.
// داخل تطبيق Capacitor على iOS، تهيئة Auth العادية تحاول تحمّل iframe وتعلق،
// فنهيئها هنا بدون نظام النوافذ المنبثقة، والتطبيق يكمل يستخدم firebase.auth() عادي.
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import { getApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence } from 'firebase/auth';

const originalInit = firebase.initializeApp.bind(firebase);
firebase.initializeApp = (...args) => {
  const app = originalInit(...args);
  try {
    initializeAuth(getApp(), { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  } catch (e) {
    console.warn('auth init', e);
  }
  return app;
};

window.firebase = firebase;
