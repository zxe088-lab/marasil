# BPM old: بناء تطبيق الآيفون من الويندوز (بدون Mac)

البناء يصير على Codemagic في السحابة، والتطبيق يوصل لـ TestFlight تلقائياً.

## الملفات في هذا المجلد (ترفعها كلها على GitHub في نفس مكان index.html)
| الملف | وظيفته |
|---|---|
| `codemagic.yaml` | خطوات البناء والتوقيع والرفع على آبل |
| `package.json` | المكتبات (Capacitor وFirebase) |
| `capacitor.config.json` | اسم التطبيق والـ Bundle ID |
| `firebase-entry.js` | نسخة Firebase المحلية للآيفون |
| `icon-1024.png` | أيقونة المتجر (1024، بدون شفافية) |
| `icon-192.png` / `icon-512.png` | الأيقونة الجديدة للموقع (تستبدل القديمة) |
| `privacy.html` / `terms.html` | سياسة الخصوصية والشروط (روابطها تحتاجها آبل) |
| `firestore.rules` | قواعد الأمان الجديدة (تنلصق في Firebase، مو ضروري ترفعها) |

⚠️ ملف `bpm-certificate-key.txt` **سري**. لا ترفعه على GitHub أبداً، مكانه Codemagic بس.

## 1) آبل (developer.apple.com وappstoreconnect.apple.com)
1. **Certificates, IDs & Profiles ← Identifiers ← +** ← App IDs ← App:
   - Description: `BPM old`
   - Bundle ID (Explicit): `com.zxe088.bpmold`
2. **App Store Connect ← Apps ← + ← New App:**
   - Platform: iOS، Name: `BPM old`، Language: Arabic، Bundle ID: `com.zxe088.bpmold`، SKU: `bpmold001`
3. **App Store Connect ← Users and Access ← Integrations ← App Store Connect API ← +:**
   - Name: `Codemagic`، Access: **App Manager**
   - نزّل ملف `.p8` (ينزل مرة وحدة بس)، وانسخ **Issuer ID** و**Key ID**

## 2) Codemagic (codemagic.io)
1. سجّل بحساب GitHub، واختر مستودع `marasil`.
2. **Team settings ← Team integrations ← Developer Portal ← Manage keys ← Add key:**
   - App Store Connect API key name: `BPM old API` (لازم نفس الاسم بالضبط)
   - Issuer ID وKey ID، وارفع ملف `.p8`
3. **Team settings ← Global variables and secrets:**
   - Group name: `ios_signing`
   - Variable name: `CERTIFICATE_PRIVATE_KEY`
   - Value: الصق محتوى `bpm-certificate-key.txt` كامل، وفعّل **Secret**
4. افتح التطبيق في Codemagic ← اختر **codemagic.yaml** ← **Start new build** ← workflow: `ios-release`

## 3) بعد البناء (تقريباً 15–25 دقيقة)
- التطبيق يوصل **TestFlight**، تنزّل تطبيق TestFlight على جوالك وتجربه.
- في App Store Connect عبّي: الوصف، لقطات الشاشة، رابط الخصوصية:
  `https://zxe088-lab.github.io/marasil/privacy.html`
- وفي **App Review Information** اكتب للمراجع إن التطبيق محادثة، وفيه بلاغ وحظر وحذف حساب.
- **Submit for Review**.

## ملاحظات
- كل بناء جديد يزيد رقم النسخة تلقائياً.
- إذا فشل البناء، أرسل لي سجل الخطوة اللي فشلت من Codemagic.
- البناء المجاني في Codemagic: 500 دقيقة شهرياً.
