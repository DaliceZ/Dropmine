# Dropmine

เว็บส่งไฟล์ระหว่างมือถือและคอมพิวเตอร์ผ่าน WebRTC โดยไม่เก็บไฟล์บนเซิร์ฟเวอร์และไม่ต้องสมัครสมาชิก โหมด local ใช้ RAM ส่วน production บน Vercel ใช้ Redis เก็บเฉพาะสถานะชั่วคราวพร้อมวันหมดอายุ

## เริ่มใช้งาน

ใช้ Node.js 22.12 ขึ้นไป (แนะนำเวอร์ชันใน `.nvmrc`) และ npm

```bash
nvm use
npm install
npm run dev
```

เปิด `http://localhost:5173` บนคอมสองหน้าต่างเพื่อทดลอง หรือเปิดผ่าน LAN IP ของคอมจากมือถือ เช่น `http://192.168.1.20:5173` ทั้งสองเครื่อง เปิดด้วย URL ที่มือถือเข้าถึงได้ก่อนสร้าง QR เพราะ QR ใช้ origin ของหน้าปัจจุบัน

เมื่อใช้ WSL2 การเปิด localhost จาก Windows กับการเปิดจากมือถือเป็นคนละเส้นทาง เครือข่าย WSL และ Windows Firewall อาจต้องตั้งค่าเพิ่มเติม หากต้องการทดสอบมือถือได้สะดวกให้ใช้ HTTPS deployment หรือรัน Node บนเครื่องที่อุปกรณ์เข้าถึงได้โดยตรง โปรเจกต์นี้ไม่ได้แก้ firewall หรือ port forwarding ให้อัตโนมัติ

## โครงสร้าง

ใช้รูปแบบ layer อ้างอิงจาก Task Dashboard ของคุณ โดยปรับให้เหมาะกับ WebSocket และข้อมูลใน RAM

```text
frontend/
  src/
    pages/transfer/                  หน้าหลักและการประกอบ UI
    components/                      Dialog, PairDialog, TransferCard
    hooks/useDropmine.ts             เชื่อม service กับ React
    services/DropmineService/         WebSocket + WebRTC และวงจรการส่งไฟล์
    types/                           สถานะ UI และข้อมูลไฟล์ที่รับ
    utils/                           การแสดงขนาดและสถานะ
  public/
  vite.config.ts
backend/
  src/
    index.ts                         entry point
    app.ts                           composition root และ dependency wiring
    config/                          environment
    modules/peer/
      peer.route.ts                  WebSocket upgrade, connection และ rate limit
      peer.handler.ts                parse และ validate คำขอ
      peer.schema.ts                 Zod schemas
      peer.type.ts                   device/transfer types
      services/peer.service.ts       discovery, pairing และสิทธิ์การส่ง
    repos/session.repo.ts            อุปกรณ์และรายการส่งใน Map ชั่วคราว
    repos/redis-session.repo.ts      shared state + atomic commit + Pub/Sub สำหรับ Vercel
    modules/peer/services/redis-peer.service.ts  ใช้ business rules เดิมใน shared transaction
    infrastructures/websocket/       การส่งข้อความผ่าน socket
    middlewares/                     security headers
    errors/
    utils/                           network grouping
shared/protocol.ts                   สัญญาข้อความและข้อจำกัดที่ใช้ร่วมกัน
api/ws.ts                            Vercel WebSocket Function
api/health.ts                        health check ของ Vercel + Redis
tests/
  backend/                           validation, permissions และ lifecycle
  e2e/                               การส่งจริงระหว่าง browser contexts
```

เส้นทาง backend คือ `route → handler → service → repo` โดย service ไม่ขึ้นกับ Express หรือ WebSocket socket และ repo ไม่ทำ business logic ส่วน frontend คือ `page/components → hook → service` ไฟล์ที่ส่งไม่ผ่าน backend และไม่มี upload endpoint

## ฟีเจอร์เวอร์ชันแรก

- ค้นพบอุปกรณ์ที่เปิดเว็บอยู่โดยประมาณจาก Public IP เดียวกัน
- ตั้งชื่ออุปกรณ์ เปิด/ปิดการมองเห็น และจับคู่ข้ามกลุ่มด้วย QR หรือลิงก์
- QR หมดอายุใน 10 นาที สร้างใหม่เพื่อยกเลิกลิงก์เก่าได้ การจับคู่ที่สำเร็จแล้วอยู่จนปิดหน้าเว็บ
- ส่งหลายไฟล์สองทิศทาง โดยผู้รับต้องยอมรับก่อนเริ่ม
- ผู้ส่งตรวจสอบผู้รับและรายการไฟล์ผ่าน modal ยืนยันก่อนส่งคำขอ
- ประวัติการส่ง/รับในแท็บนี้ พร้อมวันเวลาและสถานะ เรียงรายการล่าสุดก่อน ดูรายละเอียดรายการเก่าได้ ประวัติเก็บเฉพาะ metadata ใน RAM และหายเมื่อรีเฟรชหรือปิดแท็บ
- ชื่ออุปกรณ์และสวิตช์การมองเห็นตรึงบนแถบด้านบน ทั้งมือถือและคอมพิวเตอร์
- สลับภาษาไทย/อังกฤษ และธีมสว่าง/มืดได้ โดยใช้ธีมสว่างเป็นค่าเริ่มต้น จำการตั้งค่าภาษา ธีม และชื่อที่ตั้งเองใน localStorage ของเครื่อง ไม่บันทึกไฟล์หรือประวัติการส่งลง storage
- Dropdown ภาษาออกแบบเอง รองรับคีย์บอร์ดและตัวอ่านหน้าจอ
- ชื่อที่ผู้ใช้แก้ไขจะจำใน localStorage ของเบราว์เซอร์นี้ ถ้าไม่เคยตั้งชื่อจะสุ่มใหม่ตามเดิม การสลับการมองเห็นไม่ทำให้บันทึกชื่อสุ่ม
- สถานะการค้นพบแสดงด้วยไอคอนกระจายสัญญาณ/ซ่อน พร้อมข้อความและคำอธิบายเพื่อไม่พึ่งสีอย่างเดียว
- โลโก้และ prompt ที่ใช้สร้างอยู่ใน `docs/brand-logo.md`
- ส่งเป็น chunk ขนาด 16 KiB พร้อม backpressure เพื่อจำกัดคิวส่ง
- แสดงความคืบหน้า ความเร็ว ปฏิเสธ ยกเลิก และหมดเวลารอ
- ผู้ส่งเห็นสำเร็จเมื่อเบราว์เซอร์ผู้รับแจ้งว่ารับครบ ผู้รับยังกดบันทึกลงเครื่องแยกต่างหาก
- จำกัด 50 ไฟล์ รวม 200 MiB ต่อครั้ง และหนึ่งรายการต่ออุปกรณ์
- ไฟล์ที่รับเป็น Blob ในหน่วยความจำเบราว์เซอร์ กดบันทึกก่อนเริ่มรายการใหม่หรือปิดหน้าเว็บ ล้างได้ด้วยปุ่มในหน้ารับไฟล์
- เมื่อรับครบตั้งแต่ 2 ไฟล์ขึ้นไป กด “ดาวน์โหลดทั้งหมด (.zip)” เพื่อรวมไฟล์ที่เครื่องผู้รับได้ พร้อมลิงก์โหลดซ้ำและปุ่มบันทึกรายไฟล์ ZIP รวมไฟล์แบบไม่บีบอัดและอาจใช้หน่วยความจำเพิ่ม ชื่อซ้ำจะเติมเลขก่อนนามสกุล
- เปิด ZIP บน iPhone ด้วยแอป Files หรือ Android ด้วย Files by Google แล้วแตกไฟล์ รูปและวิดีโอต้องบันทึกเข้าแกลเลอรีแยกต่างหาก

## ข้อจำกัดที่ต้องทราบ

- Public IP เดียวกันไม่ได้ยืนยัน Wi-Fi เดียวกัน: shared NAT อาจทำให้เจอคนละเครือข่าย ส่วน VPN/IPv6 อาจทำให้เครื่องในบ้านเดียวกันไม่เจอกัน ใช้ QR เป็นทางเลือก
- QR ช่วยค้นพบและจับคู่เท่านั้น ไม่ได้แก้ firewall, client isolation หรือเครือข่ายที่บล็อก WebRTC
- ยังไม่มี TURN relay หากเชื่อมตรงไม่ได้จะแจ้งให้ลองใหม่ ไม่มีการ fallback ไปอัปโหลดไฟล์
- โหมด RAM ใช้ node server หนึ่ง instance; โหมด Vercel ใช้ Redis แชร์สถานะข้าม instance ได้ แต่การ reconnect/restart ยังอาจยกเลิกการจับคู่และการส่งที่กำลังดำเนินอยู่ ยังไม่มี resume
- Vercel Function ตั้งอายุ WebSocket ไว้ 300 วินาที ต้องทดสอบรายการส่งนานกว่า 5 นาทีก่อนเปิดใช้งานจริง
- ต้องเปิดหน้าเว็บและหน้าจอมือถือไว้ หากหลุดต้องส่งใหม่ ยังไม่มี resume
- รับไฟล์ใน RAM จึงจำกัดขนาดไว้ก่อน แม้ต่ำกว่าเพดานก็ขึ้นกับหน่วยความจำอุปกรณ์
- ยังไม่ได้ยืนยันกับ iPhone/Safari และ Android เครื่องจริง การทดสอบอัตโนมัติใช้ Chromium พร้อม viewport มือถือ
- ไฟล์ต้นฉบับและไฟล์ที่บันทึกลงเครื่องไม่ถูกลบ เซิร์ฟเวอร์เก็บเพียงสถานะเชื่อมต่อใน RAM โดยไม่มี file storage, database หรือ access log ในตัวแอป

## Production

**Vercel ทั้ง frontend และ backend:** ดู [docs/deployment.md](docs/deployment.md) ใช้ Vercel WebSocket Function + Upstash Redis เก็บสถานะชั่วคราว ตั้ง `REDIS_URL`, `REDIS_NAMESPACE`, `NETWORK_GROUP_SECRET` และ `PUBLIC_ORIGIN` ใน Vercel ไม่ต้องตั้ง `VITE_SIGNALING_URL` เมื่อ deploy เป็นโปรเจกต์เดียวกัน ไฟล์ยังส่งตรงระหว่างเบราว์เซอร์ ไม่ถูกเก็บใน Redis

**โฮสต์รวมบน Node server:**

```bash
npm run build
cp .env.example .env
npm start
```

ตั้ง `NODE_ENV=production` และ `PUBLIC_ORIGIN` ก่อนเริ่มระบบจริง Backend จะหยุดทันทีหาก production config ไม่ถูกต้อง

Backend ให้บริการไฟล์จาก `frontend/dist` และ WebSocket ที่พอร์ต 3001 ค่าเริ่มต้น ใช้ reverse proxy ที่รองรับ WebSocket และ HTTPS ตั้ง `PUBLIC_ORIGIN=https://drop.example.com` ให้ตรงกับ URL จริง

ตั้ง `TRUST_PROXY_HOPS=1` เฉพาะเมื่อมี trusted proxy หนึ่งชั้นและ Node เข้าถึงได้ผ่าน proxy เท่านั้น Proxy ต้องแทนที่/จัดการ `X-Forwarded-For` ให้ถูกต้อง หากปล่อย Node ให้เข้าถึงจากภายนอกโดยตรง ผู้ใช้สามารถปลอม header เพื่อเปลี่ยนกลุ่มได้ ค่าเริ่มต้น 0 จะไม่เชื่อ header นี้ ในโหมด dev พอร์ต backend ต้องเป็น 3001 ให้ตรงกับ Vite proxy

`STUN_URL` เป็นตัวเลือกสำหรับ ICE discovery เช่น STUN ภายในองค์กร ไม่ใช่ที่เก็บไฟล์ และไม่ได้เปิด TURN การตั้งค่านี้อาจทำให้เชื่อมผ่านเส้นทางอินเทอร์เน็ตได้ จึงไม่ควรสื่อสารว่า traffic อยู่ใน LAN เสมอ

Reverse proxy/hosting provider อาจมี access logs ของตัวเอง ควรตั้งค่าตามนโยบายความเป็นส่วนตัว ลิงก์จับคู่ใส่ token ใน URL fragment ซึ่งไม่ส่งไปใน HTTP request

## ตรวจสอบ

```bash
npm run build
npm run typecheck
npm test
npm run test:redis
npm run test:e2e:redis
npx playwright install chromium
npm run test:e2e
npm audit
```

E2E ใช้ browser contexts แยกกัน ส่งไฟล์หลายไฟล์รวมไฟล์ว่างและชื่อภาษาไทย ตรวจ SHA-256 ของไฟล์ที่ดาวน์โหลด ส่งกลับอีกทิศทาง ปฏิเสธ ยกเลิก จับคู่เครื่องที่ซ่อนตัว และตรวจ layout มือถือ/desktop

`npm run test:redis` ต้องมี `redis-server` ใน PATH หรือกำหนด `REDIS_SERVER_BIN` เป็น path ของ binary จะเปิด Redis ทดสอบชั่วคราวโดยไม่บันทึกลงดิสก์ ส่วน `npm test` จะข้าม integration tests ของ Redis หากไม่ได้ตั้ง `TEST_REDIS_URL` ห้ามตั้งค่านี้ชี้ไป production
