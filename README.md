# CED/TCT Assistant

เว็บแชตบอตสำหรับตอบคำถาม CED/TCT และการรับสมัครจากไฟล์ Excel เท่านั้น ไม่มีการเรียก Gemini หรือ LLM

## เริ่มใช้งาน

```powershell
cd C:\Users\LENOVO\Desktop\CED-TCT-Assistant
npm install
npm run dev
```

เปิด `http://localhost:3000` ในเบราว์เซอร์

## Deploy บน Vercel

Deploy **โฟลเดอร์โปรเจกต์นี้ทั้งโฟลเดอร์** ผ่าน Git repository หรือ Vercel CLI (`vercel --prod`) ห้ามลากเฉพาะโฟลเดอร์ `dist` ไป deploy เพราะ `dist` มีเฉพาะหน้าเว็บและไม่มี `/api/chat`.

ไฟล์ `api/chat.js` และ `api/health.js` เป็น Vercel Serverless Functions ซึ่งอ่าน Dataset จาก `data/Dataset_CED-TCT1_การรับสมัคร.xlsx` แบบ read-only. หลัง deploy ให้เปิด `/api/health`; ต้องได้ JSON ที่มี `ok: true` และ `records: 1249` ก่อนทดสอบหน้า Chat.

## การทำงาน

- API: `POST /api/chat` ด้วย body `{ "message": "CED ค่าเทอมเท่าไหร่" }`
- Server โหลดเฉพาะ sheet `Dataset รวม` ที่เริ่มทำงาน แล้ว cache ข้อมูลและ search index (1,249 แถว)
- Query Understanding สร้าง canonical query จาก normalization, dataset-driven intent, generic entity extraction และ conversation context
- Domain index สแกน Dataset รวมเพื่อสร้าง program, topic, course-code, ปีการศึกษา, ระดับการศึกษา และ admission-round catalog
- Hybrid retrieval ใช้ corpus vector similarity (TF-IDF cosine), lexical overlap และ fuzzy score จากนั้น re-rank ด้วย entity compatibility, intent/category compatibility และ conflict penalty
- คะแนนต่ำกว่า `0.35` หรือมี retrieval evidence ต่ำจะตอบว่าไม่พบข้อมูล; candidate ที่สูสีกันแต่ต่าง entity สำคัญจะถามกลับ
- ตั้ง `DEBUG_CHAT=true` ใน `.env` เพื่อดู original/normalized query, intent, entities, inherited context, candidates, component scores, conflict และ ambiguity decision ใน terminal

รัน `npm test` เพื่อตรวจ 10 กรณีทดสอบ, `npm run evaluate` เพื่อประเมิน query variations และ `npm run build` เพื่อตรวจ production build
