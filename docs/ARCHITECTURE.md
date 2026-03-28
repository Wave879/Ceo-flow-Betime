# สถาปัตยกรรมระบบ - CEO Flow

> อัปเดตล่าสุด: 23 มีนาคม 2026

---

## แผนภาพสถาปัตยกรรมระบบ

```text
+-----------------------------------------------------------------------------------+
|                                ฝั่งผู้ใช้งาน (Browser)                          |
|                                                                                   |
|  React + Vite + Tailwind                                                          |
|  - โครงหลักของแอป + เมนูด้านบน                                                   |
|  - หน้า Overview (CEO Decision Queue + delete task)                               |
|  - หน้า Projects (LINE Group list + rename + task list)                           |
|  - หน้า Portfolio                                                                 |
|  - หน้า Staff                                                                     |
|  - Task Detail Modal (Details | Timeline | Attachments | Chat Panel)              |
|  - Firestore Hook (รองรับ Firebase/Local fallback)                               |
|                                                                                   |
|            HTTPS /api/webhook                         HTTPS /api/notify           |
+-----------------------------+-----------------------------------+-----------------+
                              |                                   |
                              v                                   v
+-----------------------------------------------------------------------------------+
|                       Cloudflare Functions (Serverless API)                       |
|                                                                                   |
|  functions/api/webhook.js                                                         |
|  - รับ LINE webhook (HMAC-SHA256 signature verify)                                |
|  - dedup ด้วย KV (gันข้อความซ้ำ)                                                  |
|  - /test — health check                                                           |
|  - /สั่ง — force-create task (fast path, 0 AI)                                   |
|  - /แจ้งงาน — Flex Message สรุปงานทั้งหมดในกลุ่ม                                 |
|  - /แจ้งเตือนส่วนตัว — push งานของ user นั้นไปยัง DM ส่วนตัว                     |
|  - auto meeting-summary task parser                                               |
|  - AI เลขา (chat session / Azure OpenAI)                                          |
|  - flow อัปเดตสถานะงาน                                                             |
|                                                                                   |
|  functions/api/notify.js                                                          |
|  - ระบบเตือนงานตามกำหนด (D-3 / D-1 / D-DAY)                                        |
|  - กันส่งซ้ำด้วย notificationLogs                                                     |
|  - broadcast งานใหม่                                                               |
|  - สร้างข้อความ LINE Flex                                                           |
+-----------------------------+-----------------------------------+-----------------+
                              |                                   |
                              v                                   v
+------------------------------+                 +----------------------------------+
| Firestore REST API           |                 | บริการภายนอก                      |
| Collections หลัก:            |                 | - LINE Messaging API              |
| - employees                  |                 | - Azure OpenAI (Soundwave)        |
| - lineUsers                  |                 | - Cloudflare KV (dedup/state)     |
| - tasks                      |                 +----------------------------------+
| - projects                   |
| - projects/{id}/messages     |
| - projects/{id}/members      |
| - groupUsers                 |
| - groupMemberLinks           |
| - positions                  |
| - taskSessions               |
| - taskCreateSessions         |
| - chatSessions               |
| - notificationLogs           |
+------------------------------+
```

---

## องค์ประกอบหลักของระบบ

### ฝั่ง Frontend (`src/`)

| องค์ประกอบ | หน้าที่ |
|---|---|
| `src/App.jsx` | โครงหน้าเว็บหลัก, เมนูสลับหน้า, ธีม |
| `src/pages/OverviewPage.jsx` | ภาพรวมระบบ, CEO Decision Queue (+ ปุ่มลบ task), กราฟสถิติ |
| `src/pages/ProjectsPage.jsx` | รายการ LINE Group, รายการ task ต่อกลุ่ม, ตั้งชื่อกลุ่ม (rename), แชทในกลุ่ม |
| `src/pages/PortfolioPage.jsx` | ภาพรวมทีมและงานรายบุคคล |
| `src/pages/StaffPage.jsx` | รายชื่อพนักงาน |
| `src/components/TaskDetailModal.jsx` | รายละเอียดงาน, Timeline, แนบไฟล์, เปลี่ยนสถานะ, **Chat Panel (ขวา)** |
| `src/hooks/useFirestore.js` | อ่าน/เขียนข้อมูล (Firebase + fallback), เรียก `/api/notify` ตาม flow |
| `src/hooks/useTheme.jsx` | จัดการโหมดสีและการจำค่า |

### ฝั่ง Backend (`functions/api/`)

| ไฟล์ | หน้าที่ |
|---|---|
| `webhook.js` | สมองหลักของบอท LINE: ลงทะเบียน, คำสั่งงาน, session, AI, role check, /สั่ง, /แจ้งงาน, /แจ้งเตือนส่วนตัว |
| `notify.js` | เตือนงานอัตโนมัติและประกาศงานผ่าน LINE |

---

## ลำดับการทำงานหลัก (Primary Flows)

### 1) ลงทะเบียนผู้ใช้ LINE

```text
ผู้ใช้พิมพ์ "ลงทะเบียน"
  -> webhook สร้าง pendingRegistrations/{lineUserId}
ผู้ใช้พิมพ์ชื่อ-นามสกุล
  -> ค้นหาใน employees
  -> บันทึกการผูกบัญชีใน lineUsers
  -> ลบ pendingRegistrations
  -> ตอบกลับว่าสำเร็จ
```

### 2) เช็คงาน (`เช็คงาน`)

```text
ผู้ใช้พิมพ์ "เช็คงาน"
  -> map lineUsers -> employees
  -> query งานที่ยังไม่เสร็จตาม assignee
  -> สร้าง Flex Message กล่องเดียว
  -> ตอบกลับพร้อมปุ่มดูงานและปุ่มสถานะ
```

### 3) อัปเดตสถานะงาน (`สถานะ`)

```text
ผู้ใช้พิมพ์ "สถานะ"
  -> เปิด taskSessions/{lineUserId} step=selectTask
ผู้ใช้เลือกงาน (1/2/3/เพิ่มเติม)
  -> เข้าสู่ step เลือกการกระทำ
เลือก "อัปเดตความคืบหน้า" -> waitNote -> บันทึก lastUpdate
เลือก "งานเสร็จสิ้นแล้ว" -> set status=completed
```

### 4) สั่งงานใหม่ (`สั่งงาน`) สำหรับ admin

```text
admin พิมพ์ "สั่งงาน"
  -> ตรวจ role จาก employees.role
  -> ถ้าไม่ใช่ admin ให้ปฏิเสธ
  -> สร้าง taskCreateSessions/{lineUserId} step=waitName

waitName      -> รับชื่องาน
waitAssignees -> รับผู้รับผิดชอบและ map employee
waitDeadline  -> รับวันกำหนดส่ง YYYY-MM-DD หรือ "-"
waitType      -> รับประเภท team/individual
createTask    -> บันทึกลง tasks และปิด session
```

### 5) แจ้งเตือนงาน (`/api/notify`)

```text
cron/manual trigger -> notify.js
  -> ดึง lineUsers
  -> ดึงงานของแต่ละ user
  -> คำนวณเงื่อนไขเตือน (D-3, D-1, D-DAY)
  -> ตรวจส่งซ้ำด้วย notificationLogs
  -> ส่ง LINE Flex
  -> บันทึก log
```

### 6) โหมดถามเลขา (`ถามเลขา`)

```text
ผู้ใช้พิมพ์ "ถามเลขา ..."
  -> เปิด/ต่อ chatSessions
  -> เรียก Azure OpenAI Responses API (fallback Chat Completions)
  -> บันทึก history แบบย่อ
  -> ตอบกลับข้อความ AI
  -> หมดเวลา session อัตโนมัติเมื่อไม่ใช้งานนาน
```

### 7) สรุปงานกลุ่ม (`/แจ้งงาน`)

```text
สมาชิกพิมพ์ "/แจ้งงาน" ในกลุ่ม LINE
  -> webhook query tasks collection filter projectId = groupId
  -> อ่านชื่อกลุ่มจาก projects doc (name > webProjectName > groupName)
  -> build LINE Flex Message (header สีน้ำเงิน + task list + footer ปุ่ม)
  -> replyFlex ในกลุ่ม
  -> footer มีปุ่ม "🔔 แจ้งเตือนส่วนตัว"
```

### 8) แจ้งเตือนส่วนตัว (`/แจ้งเตือนส่วนตัว`)

```text
สมาชิกกดปุ่ม "🔔 แจ้งเตือนส่วนตัว" ใน Flex / พิมพ์ command
  -> webhook ตอบในกลุ่มว่า "ส่งรายการงานไปยัง chat ส่วนตัวแล้ว"
  -> query tasks ที่ lineAssigneeIds ARRAY_CONTAINS userId (+ filter groupId ถ้าอยู่ในกลุ่ม)
  -> pushText ไปยัง LINE DM ของ user (ต้อง add บอทเป็นเพื่อนก่อน)
  -> ถ้า push ไม่ได้ (user ยังไม่ add บอท) = silent fail
```

### 9) ตั้งชื่อกลุ่ม (Web UI)

```text
หน้า Projects > เลือกกลุ่ม > คลิกไอคอนดินสอ ✏️ ข้างชื่อกลุ่ม
  -> ช่อง input inline + ปุ่ม ✓ / ✕
  -> บันทึก updateDoc(projects/{groupId}, { name })
  -> อัปเดต state UI ทันที
  -> บอทจะอ่านชื่อนี้ใน /แจ้งงาน ครั้งถัดไป
```

---

## โครงสร้างข้อมูล (Data Model)

### `employees`
- `_id` (doc id)
- `id` (รหัสพนักงานเชิงธุรกิจ)
- `fullName`, `name`
- `position`, `role` (`admin` | `employees`)
- profile: `avatar`, `bio`, `color`

### `lineUsers`
- `lineUserId`, `employeeId`, `employeeDocId`
- `employeeName`, `nickname`, `linkedAt`

### `tasks`
- `id`, `name`, `title`
- `projectId` — LINE group ID ที่งานนี้สังกัด
- `assignees[]` (employee IDs), `assignee` (ชื่อหลัก)
- `lineAssigneeIds[]`, `lineAssigneeNames[]`
- `deadline`, `deadlineText`
- `type` (`team` | `individual`)
- `status` (`pending` | `in-progress` | `completed` | `abandoned`)
- `source` (`line-meeting-summary` | `line-tagged-task` | `manual`)
- `lineMessageId`, `lineContextMessageIds[]`
- `createdAt`, `createdBy`, `createdByName`, `updatedAt`
- optional: `completedAt`, `attachments[]`, `lastUpdate`, `lastUpdatedAt`

### `projects`
- `id` — LINE group ID
- `name` — ชื่อที่ตั้งเองจาก web UI (ใช้ใน /แจ้งงาน)
- `groupName`, `webProjectName` — ชื่อ fallback
- `pictureUrl`, `memberCount`, `groupType`
- `source`, `updatedAt`

### `projects/{groupId}/messages`
- บันทึกข้อความแชทในกลุ่ม (ทั้ง user และ bot)
- `lineUserId`, `senderRole` (`bot` | `user`)
- `text`, `type`, `createdAt`

### `projects/{groupId}/members`
- สมาชิกในกลุ่มนั้น

### `groupUsers`
- `userId` (LINE user ID)
- `displayName`, `projectGroup`, `source`
- `firstSeen`, `lastSeen`

### `groupMemberLinks`
- เชื่อม group <-> LINE user
- `groupId`, `lineUserId`, `displayName`

### คอลเลกชัน session/log
- `taskSessions` — session อัปเดตสถานะ
- `taskCreateSessions` — session สั่งงาน (admin)
- `chatSessions` — session ถามเลขา (AI)
- `notificationLogs` — กันส่งเตือนซ้ำ + audit

---

## State Machine ของ Session

### `taskSessions`

```text
selectTask -> selectAction -> waitNote -> done
                       \-> complete -> done
timeout(5 นาที) -> expired -> ลบ session
```

### `taskCreateSessions`

```text
waitName -> waitAssignees -> waitDeadline -> waitType -> createTask -> done
ทุกขั้น + "ยกเลิกสั่งงาน" -> cancel -> ลบ session
```

### `chatSessions`

```text
active -> รับข้อความ -> เรียก AI -> บันทึก history -> active
ไม่ใช้งานเกิน 3 นาที -> expire -> ลบ session
```

---

## กติกาสิทธิ์ (Role & Authorization)

| การกระทำ | admin | employees |
|---|---:|---:|
| ลงทะเบียน LINE | Yes | Yes |
| `เช็คงาน` | Yes | Yes |
| `สถานะ` (อัปเดตงานของตัวเอง) | Yes | Yes |
| `/สั่ง` (สร้างงานด่วนจาก LINE) | Yes | Yes |
| `/แจ้งงาน` (ดูงานทั้งหมดในกลุ่ม) | Yes | Yes |
| `/แจ้งเตือนส่วนตัว` (push งานตัวเองไป DM) | Yes | Yes |
| `สั่งงาน` session (สร้างงานแบบ guided) | Yes | No |
| ลบ task บน CEO Flow web | Yes | Yes |
| ตั้งชื่อกลุ่ม (rename) บน web | Yes | Yes |

แหล่งตรวจสิทธิ์:
- map LINE user → `lineUsers` → `employees.role`

---

## สถาปัตยกรรม Chat Panel

`TaskDetailModal` มี 2 column เรียงแนวนอน:
- **ซ้าย** (`flex-1`): รายละเอียดงาน, Tabs, Footer action
- **ขวา** (`w-72 xl:w-80`): `TaskChatPanel` — แสดง real-time chat จาก `projects/{projectId}/messages`

Chat Panel:
- subscribe `onSnapshot` บน subcollection `messages` (orderBy createdAt asc ใน JS)
- bubble สีเขียว (`#9FE870`) = bot, bubble ขาว/dark = user
- แสดง avatar ตัวอักษรย่อ และชื่อผู้ส่ง

---

## สถาปัตยกรรม Timeline

ปัจจุบันใน `TaskDetailModal` สร้าง timeline จาก field ที่มีใน task:
- `createdAt/startDate` → เหตุการณ์เริ่ม/สั่งงาน
- `updatedAt` → เหตุการณ์แก้ไขข้อมูล
- `lastUpdatedAt + lastUpdate` → เหตุการณ์อัปเดตความคืบหน้า
- `completedAt/status=completed` → เหตุการณ์สิ้นสุดงาน
- `attachments[].addedAt` ล่าสุด → เหตุการณ์แนบไฟล์

แผนถัดไป: ย้ายไปใช้ event log จริงที่ `tasks/{taskId}/timeline/{eventId}`

---

## สัญญาเชื่อมต่อ (Integration Contracts)

### อินพุตจาก LINE Webhook
- รับ event ประเภทข้อความ (`event.type=message`, `message.type=text`)
- ใช้ `source.userId`, `source.groupId`, `replyToken`
- verify HMAC-SHA256 signature (`x-line-signature`)
- dedup ด้วย Cloudflare KV (`msg_dedup_v1:{messageId}`)

### เอาต์พุตไป LINE
- `replyText` — ข้อความ text ธรรมดา
- `replyFlex` — LINE Flex Message (Bubble)
- `pushText` — push ไปยัง user DM (ต้อง add บอทเป็นเพื่อน)

### คำสั่ง LINE ที่รองรับ

| Command | สถานที่ | หน้าที่ |
|---|---|---|
| `/test` | กลุ่ม | health check |
| `/สั่ง <ชื่องาน>` | กลุ่ม | สร้าง task ทันที (fast path) |
| `/แจ้งงาน` | กลุ่ม | Flex Message สรุปงานทั้งหมดในกลุ่ม |
| `/แจ้งเตือนส่วนตัว` | กลุ่ม/DM | push งานของคนกดไปยัง DM |
| `ถามเลขา ...` | กลุ่ม/DM | AI secretary chat session |
| `จบถามเลขา` | กลุ่ม/DM | ปิด AI session |
| `เชื่อมต่อระบบ` | กลุ่ม | ลงทะเบียนกลุ่ม |
| `/มีชีวิต` / `/จบชีวิต` | กลุ่ม | เปิด/ปิด alive mode |

### Azure OpenAI
- Primary: Responses API
- Fallback: Chat Completions API
- Env: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`

---

## ความเสถียรและความปลอดภัย

### ที่มีอยู่แล้ว
- verify HMAC-SHA256 signature LINE webhook ทุก request
- dedup event ด้วย Cloudflare KV (กัน race condition / replay)
- กันแจ้งเตือนซ้ำด้วย `notificationLogs`
- timeout + ลบ session อัตโนมัติ
- Firestore query ใช้ single-field index (ไม่ต้อง composite) เพื่อความเสถียร
- error fallback: ถ้า Flex ส่งไม่สำเร็จ → fallback เป็น plain text

### ที่ควรเพิ่ม
- audit log สำหรับทุกการเปลี่ยนแปลงงาน
- retry policy เมื่อ external API ล้มเหลว
- validation เชิงลึกของ deadline/assignee/type

---

## โครงสร้างการ Deploy

```text
Cloudflare Pages (Frontend: React + Vite)
  + Cloudflare Functions (API: webhook, notify)
      - /api/webhook  ← LINE Messaging API
      - /api/notify   ← cron / manual trigger
  + Cloudflare KV     ← dedup, state, known groups

External:
  - Firebase Firestore REST API
  - LINE Messaging API
  - Azure OpenAI
```

## Environment Variables

### จำเป็น
- `LINE_TOKEN` — LINE Channel Access Token
- `LINE_CHANNEL_SECRET` — สำหรับ verify webhook signature
- `FIREBASE_PROJECT_ID` — Firestore project
- `FIREBASE_API_KEY` — Firestore Web API key

### ทางเลือก
- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`
- `NOTIFY_CRON_SECRET`
- `WEB_APP_URL` / `APP_URL`
- `BRAND_IMAGE_URL` / `FLEX_BRAND_IMAGE_URL`

---

## ช่องว่างปัจจุบัน / งานต่อไป

1. Push `/แจ้งเตือนส่วนตัว` ทำงานได้เฉพาะ user ที่ add บอทเป็นเพื่อนแล้ว (LINE policy)
2. ย้าย Timeline จากการ infer field ไป event log จริง (`tasks/{id}/timeline/`)
3. เพิ่ม composite Firestore index สำหรับ query ที่ต้อง filter + sort พร้อมกัน
4. เพิ่ม observability (structured logs + metrics)
