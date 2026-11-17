# เพชรสยาม (Splendor ธีมสยาม) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เกมแนว Splendor ธีมสยามโบราณ เล่นออนไลน์เรียลไทม์ 2–5 คนผ่านลิงก์ โดยเซิร์ฟเวอร์ตัดสินกติกา และภาพทั้งหมดมาจาก PixelLab

**Architecture:** Node + Express + Socket.io รันเป็น process เดียว เสิร์ฟไฟล์ใน `public/` เป็นสแตติก กติกาอยู่ใน `server/rules.js` เป็น pure function (`applyAction(state, playerIdx, action) → {state} | {error}`) ห้องและ socket อยู่ใน `server/rooms.js` + `server/index.js` ไคลเอนต์เป็น vanilla JS ที่วาดหน้าจอจาก `view` ที่เซิร์ฟเวอร์ส่งมาให้แต่ละคน

**Tech Stack:** Node 22, express 4, socket.io 4, socket.io-client (dev), node:test

**Spec:** `docs/superpowers/specs/2026-11-17-splendor-siam-design.md`

## Global Constraints
- ห้ามมีคำว่า "Splendor" ใน UI หรือชื่อเกม ชื่อเกมคือ **เพชรสยาม**
- UI ภาษาไทยทั้งหมด
- ตารางของตามจำนวนผู้เล่น: 2→อัญมณี 4/ขุนนาง 3, 3→5/4, 4→7/5, 5→7/6 ทองเท่ากับ 5 ทุกกรณี
- ชนะที่ 15 แต้ม เล่นต่อจนครบรอบ ถ้าเสมอกัน คนที่มีการ์ดน้อยกว่าชนะ ถ้ายังเสมอ ให้ชนะร่วมกัน
- ถืออัญมณีได้ไม่เกิน 10 เม็ด และจองการ์ดได้ไม่เกิน 3 ใบ
- ใช้ PixelLab ได้ไม่เกิน 300 generations
- ไม่มีขั้นตอน build ฝั่งไคลเอนต์

## Review Focus
1. ผู้เล่นส่ง action ทั้งที่ไม่ใช่ตาตัวเอง หรือส่ง payload มั่วมา → เซิร์ฟเวอร์ต้องปฏิเสธ และสถานะต้องไม่เปลี่ยน
2. หยิบอัญมณี 3 สีในขณะที่บนกระดานเหลือไม่ถึง 3 สี → หยิบได้เท่าที่มี แต่ต้องหยิบให้ได้มากที่สุดเท่าที่ทำได้ และสีต้องไม่ซ้ำ
3. จองการ์ดจากกองที่หมดแล้ว หรือทองหมด → ถ้ากองหมดจะจองไม่ได้ ถ้าทองหมดยังจองได้แต่ไม่ได้ทอง
4. เปิดแท็บซ้ำหรือรีเฟรชหน้า → ต้องได้ที่นั่งเดิมคืน ไม่เกิดผู้เล่นซ้อน
5. คนที่ถึงตาหลุดออกไป → เกมไม่ค้าง หัวห้องกดข้ามตาได้

---

### Task 1: ข้อมูลการ์ดและขุนนาง
**Files:** Create `package.json`, `server/data.js`, `scripts/build-data.py` (one-off), `test/data.test.js`
**Interfaces — Produces:** `COLORS = ['white','blue','green','red','black']`; `CARDS: {id:number, tier:1|2|3, color, points, cost:{white..black}}[]` (90 ใบ); `NOBLES: {id, points:3, req:{...}}[]` (10 ใบ)
- [ ] เขียนเทสต์: จำนวนการ์ดแต่ละระดับคือ 40/30/20 แต่ละสีมี 18 ใบ ขุนนาง 10 ใบ id ไม่ซ้ำกัน และผลรวมการ์ดตรงกับ `cards.csv` ที่มาจากอีกแหล่ง
- [ ] สร้าง `data.js` จาก lapidary `game.py` แล้วตรวจกับ csv → รันเทสต์ให้ผ่าน → commit

### Task 2: เอนจินกติกา
**Files:** Create `server/rules.js`, `test/rules.test.js`
**Interfaces — Produces:**
`createGame(players:{id,name}[], rng?) → State`;
`applyAction(state, playerIdx, action) → {state} | {error:string}` (ไม่แก้ object ที่รับเข้ามา)
โดย action มีแบบ `{type:'take3', colors:[...]}`, `{type:'take2', color}`, `{type:'reserve', tier, slot|null}` (null = จองจากกองคว่ำ), `{type:'buy', source:'board'|'reserved', tier?, slot?, index?}`, `{type:'discard', gems:{...}}`, `{type:'chooseNoble', nobleId}`, `{type:'skip'}`
State: `{phase:'play'|'discard'|'noble'|'over', turn, round, finalRound:boolean, bank, decks[3], board[3][4], nobles, players[{id,name,gems,cards,reserved,nobles}], winners:[], log:[] }`
- [ ] เทสต์ตามตาราง Global Constraints: setup ทั้ง 4 ขนาด, take3 ตามข้อจำกัด (Review Focus 2), take2 ต้องมี ≥4 ในกอง, reserve (Review Focus 3) และจองครบ 3 ใบแล้วจองต่อไม่ได้, buy โดยหักโบนัสและใช้ทองแทน, เกิน 10 → phase `discard`, ขุนนาง 1 คน → มาเอง, หลายคน → phase `noble`, ไม่ใช่ตาตัวเอง → error, จบเกมและการตัดสินเสมอ
- [ ] implement → เทสต์ผ่าน → commit

### Task 3: มุมมองเฉพาะคน
**Files:** Modify `server/rules.js` (+`viewFor(state, playerIdx|null)`), test
- [ ] เทสต์: ไม่ส่ง `decks` ไป (ส่งแค่จำนวน) การ์ดที่คนอื่นจองจากกองคว่ำจะเป็น `{hidden:true, tier}` ส่วนการ์ดที่จองจากกระดานยังเห็นปกติ (ต้องเก็บ flag `fromDeck` ตอนจอง)
- [ ] implement → commit

### Task 4: ห้องและ socket
**Files:** Create `server/rooms.js`, `server/index.js`, `test/server.test.js`
**Interfaces:** Client→Server: `create {name}`, `join {code, name, token?}`, `start`, `action {...}`, `skipTurn`, `claimSeat {seatIdx}`, `restart`. Server→Client: `joined {code, token, seat}`, `room {code, hostSeat, players[{name, online}], started}`, `state view`, `err {msg}`
- [ ] เทสต์แบบ integration ด้วย socket.io-client: สร้างห้องแล้วเข้า 2 คนแล้วเริ่มได้, คนที่ 6 ถูกปฏิเสธ, token ใช้กลับเข้าที่นั่งเดิมได้ (Review Focus 4), หัวห้องหลุดแล้วสิทธิ์ย้าย, skipTurn (Review Focus 5), ส่ง action มั่วแล้วได้ `err`
- [ ] implement → commit

### Task 5: ไคลเอนต์ (ใช้ภาพชั่วคราวไปก่อน)
**Files:** Create `public/index.html`, `public/style.css`, `public/app.js`, `public/assets/` (manifest `assets.json`)
- [ ] หน้าแรก / ห้องรอ / กระดาน / จบเกม ตามสเปกข้อ 8 UI ภาษาไทย ถ้า asset ยังไม่มีให้ใช้ CSS แทน
- [ ] ตรวจด้วยการเปิดเบราว์เซอร์จริง 3 แท็บ แล้วเล่นจนจบ (ใช้สคริปต์บอทช่วยเล่นเร็วด้วย socket client) → commit

### Task 6: Asset จาก PixelLab
- [ ] ทดลองสไตล์ 3–4 ภาพ → ส่งให้ผู้ใช้ดู (ไม่หยุดรอ เพราะผู้ใช้สั่งให้ทำต่อจนเสร็จ)
- [ ] เจนทั้งชุดตามสเปกข้อ 9 → export ลง `public/assets/` → ใส่เข้า manifest → นับจำนวน generations ที่ใช้
- [ ] ตรวจด้วยภาพหน้าจอ → commit

### Task 7: คู่มือ deploy + ตรวจรอบสุดท้าย
**Files:** `README.md` (คู่มือ deploy ภาษาไทยทีละขั้น ผ่าน GitHub → Render), `render.yaml`
- [ ] `npm test` ผ่านทั้งหมด, บอทเล่นจนจบ 2–5 คนครบทุกขนาด, ตรวจโค้ดทั้ง branch → zip ส่งให้ผู้ใช้
