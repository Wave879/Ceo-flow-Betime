# สถาปัตยกรรมระบบ - TeamFlow Pro

> อัปเดตล่าสุด: 9 มีนาคม 2026

---

## แผนภาพสถาปัตยกรรมระบบ

```text
+-----------------------------------------------------------------------------------+
|                                ฝั่งผู้ใช้งาน (Browser)                          |
|                                                                                   |
|  React + Vite + Tailwind                                                          |
|  - โครงหลักของแอป + เมนูด้านบน                                                   |
|  - หน้า Overview                                                                  |
|  - หน้า Portfolio                                                                 |
|  - Task Detail Modal (Details | Timeline | Attachments)                          |
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
|  - รับ LINE webhook                                                                |
|  - flow ลงทะเบียน (lineUsers <-> employees)                                        |
|  - flow อัปเดตสถานะงาน                                                             |
|  - flow "สั่งงาน" เฉพาะแอดมิน (taskCreateSessions)                                   |
|  - AI เลขา (chat session)                                                         |
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
| - lineUsers                  |                 +----------------------------------+
| - tasks                      |
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
| `src/pages/OverviewPage.jsx` | ภาพรวมระบบ, รายการงาน, ปุ่ม action หลัก |
| `src/pages/PortfolioPage.jsx` | ภาพรวมทีมและงานรายบุคคล |
| `src/components/TaskDetailModal.jsx` | รายละเอียดงาน, Timeline, แนบไฟล์, เปลี่ยนสถานะ |
| `src/hooks/useFirestore.js` | อ่าน/เขียนข้อมูล (Firebase + fallback), เรียก `/api/notify` ตาม flow |
| `src/hooks/useTheme.jsx` | จัดการโหมดสีและการจำค่า |

### ฝั่ง Backend (`functions/api/`)

| ไฟล์ | หน้าที่ |
|---|---|
| `webhook.js` | สมองหลักของบอท LINE: ลงทะเบียน, คำสั่งงาน, session, AI, role check |
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

---

## โครงสร้างข้อมูล (Data Model)

### `employees`
- `_id` (doc id)
- `id` (รหัสพนักงานเชิงธุรกิจ)
- `fullName`
- `name`
- `position`
- `role` (`admin` | `employees`)
- profile: `avatar`, `bio`, `color`

### `lineUsers`
- `lineUserId`
- `employeeId`
- `employeeDocId`
- `employeeName`
- `nickname`
- `linkedAt`

### `tasks`
- `id`
- `name`
- `assignees` (array)
- `deadline`
- `type` (`team` | `individual`)
- `status` (`pending` | `in-progress` | `completed`)
- `description`
- `lastUpdate`
- `lastUpdatedAt`
- `lastUpdatedBy`
- `createdAt`, `createdBy`, `createdByName`
- `updatedAt`, `updatedBy`
- optional: `completedAt`, `attachments[]`

### คอลเลกชัน session/log
- `taskSessions` (session ของคำสั่งสถานะงาน)
- `taskCreateSessions` (session ของคำสั่งสั่งงาน)
- `chatSessions` (session คุยกับ AI)
- `notificationLogs` (กันส่งเตือนซ้ำ + audit)

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
| `สั่งงาน` (สร้างงานใหม่จากบอท) | Yes | No |
| ลบงานผ่านบอท | แผนถัดไป | แผนถัดไป |

แหล่งตรวจสิทธิ์:
- map LINE user -> `lineUsers`
- map ไป employee -> `employees`
- ตรวจค่า `employees.role`

---

## สถาปัตยกรรม Timeline

ปัจจุบันใน `TaskDetailModal` สร้าง timeline จาก field ที่มีใน task:
- `createdAt/startDate` -> เหตุการณ์เริ่ม/สั่งงาน
- `updatedAt` -> เหตุการณ์แก้ไขข้อมูล
- `lastUpdatedAt + lastUpdate` -> เหตุการณ์อัปเดตความคืบหน้า
- `completedAt/status=completed` -> เหตุการณ์สิ้นสุดงาน
- `attachments[].addedAt` ล่าสุด -> เหตุการณ์แนบไฟล์

ค่า fallback:
- ถ้าไม่พบผู้กระทำ/เวลา ใช้ค่าพื้นฐานเพื่อไม่ให้ timeline ว่าง

แผนถัดไป:
- ย้ายไปใช้ event log จริงที่ `tasks/{taskId}/timeline/{eventId}`

---

## สัญญาเชื่อมต่อ (Integration Contracts)

### อินพุตจาก LINE Webhook
- รับ event ประเภทข้อความ (`event.type=message`, `message.type=text`)
- ใช้ `source.userId`, `replyToken`

### เอาต์พุตไป LINE
- ข้อความ text
- Flex message (กล่องเดียว)
- ปุ่ม action เช่น เปิดเว็บ/ส่งคำสั่ง `สถานะ`

### Azure OpenAI
- Primary: Responses API
- Fallback: Chat Completions API
- Env ที่ใช้:
  - `AZURE_OPENAI_ENDPOINT`
  - `AZURE_OPENAI_API_KEY`
  - `AZURE_OPENAI_DEPLOYMENT`
  - `AZURE_OPENAI_API_VERSION`

---

## ความเสถียรและความปลอดภัย

### ที่มีอยู่แล้ว
- กันแจ้งเตือนซ้ำด้วย `notificationLogs`
- ตั้ง timeout + ลบ session อัตโนมัติ
- ตรวจสิทธิ์ role สำหรับคำสั่ง admin-only
- มี fallback เมื่อข้อมูลผูกบัญชีไม่ครบ

### ที่ควรเพิ่ม
- idempotency token ใน flow สร้างงาน
- validation เชิงลึกของ deadline/assignee/type
- audit log สำหรับทุกการเปลี่ยนแปลงงาน
- retry policy เมื่อ external API ล้มเหลว

---

## โครงสร้างการ Deploy

```text
Cloudflare Pages (Frontend)
  + Cloudflare Functions (API)
      - /api/webhook
      - /api/notify

External:
  - Firestore REST
  - LINE Messaging API
  - Azure OpenAI
```

---

## Environment Variables

### จำเป็น
- `LINE_TOKEN`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT`

### ทางเลือก
- `AZURE_OPENAI_API_VERSION`
- `NOTIFY_CRON_SECRET`
- `WEB_APP_URL` / `APP_URL`
- `BRAND_IMAGE_URL` / `FLEX_BRAND_IMAGE_URL`

---

## ช่องว่างปัจจุบัน / งานต่อไป

1. ปรับ encoding ของข้อความไทย legacy บางส่วนใน backend
2. ย้าย Timeline จากการ infer field ไป event log จริง
3. เพิ่มคำสั่ง admin CRUD ครบชุด (แก้/ลบ/มอบหมายใหม่)
4. เพิ่ม integration test สำหรับ session flow สำคัญ
5. เพิ่ม observability (structured logs + metrics)
