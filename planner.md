# Meeting Bot Planner (LINE Group + TeamFlow)

## Goal
- เพิ่มความสามารถบอทใน LINE Group ให้รองรับงานประชุมเสียงยาว
- flow หลัก: `เรียกเลขา` -> รับไฟล์เสียง -> ถอดเสียง+สรุป -> ดึง Action Items -> หัวหน้าคอนเฟิร์ม -> สร้างงานลงเว็บ

## Scope V1
- รองรับคำสั่งในกลุ่ม: `เรียกเลขา`
- บอทตอบกลับ: `เลขาพร้อมแล้วค่ะ`
- บอทรอรับไฟล์เสียง/วิดีโอจากกลุ่ม
- ประมวลผลไฟล์ประชุม 30 นาที - 2 ชั่วโมงแบบ async
- ส่งสรุปประชุม + รายการงานที่สกัดได้
- ให้หัวหน้าแผนกกดยืนยันก่อนบันทึกงานลงระบบ

## User Flow
1. ผู้ใช้พิมพ์ `เรียกเลขา` ในกลุ่ม
2. บอทตอบ: `เลขาพร้อมแล้วค่ะ กรุณาส่งไฟล์เสียงประชุม`
3. ผู้ใช้ส่งไฟล์เสียง/วิดีโอ
4. บอทตอบรับงาน: `รับไฟล์แล้ว กำลังถอดเสียงและสรุป (ใช้เวลา ~5-20 นาที)`
5. ระบบถอดเสียง + สรุปตาม prompt ประชุม
6. ระบบดึง Action Items:
   - งาน
   - ผู้รับผิดชอบ (ถ้าระบุได้)
   - deadline (ถ้ามี)
   - priority (ถ้ามี)
7. บอทส่งผลสรุปกลับกลุ่ม (Flex 1 กล่อง + ปุ่ม)
8. หัวหน้าแผนกกด `ยืนยันสร้างงาน`
9. ระบบเขียนงานลง TeamFlow + แจ้งผลกลับกลุ่ม

## Commands
- `เรียกเลขา` : เปิดโหมดรับไฟล์ประชุม
- `ยกเลิกเลขา` : ปิดโหมดรอไฟล์
- `สถานะงานประชุม` : ดูสถานะประมวลผลล่าสุด
- `ยืนยันสร้างงาน` : เฉพาะหัวหน้าแผนก
- `แก้ไขผู้รับผิดชอบ` : แก้ owner ก่อนบันทึกจริง

## Architecture
- LINE Webhook (Cloudflare Function): รับ event ข้อความ/ไฟล์
- Media Fetch Worker: ดึงไฟล์จาก LINE content API
- Storage: R2 / S3-compatible สำหรับไฟล์ต้นฉบับ
- Job Queue: Cloudflare Queues (หรือคิวเทียบเท่า)
- STT Service: ผู้ให้บริการถอดเสียงที่รองรับไฟล์ยาว
- LLM Summarizer: prompt เฉพาะประชุม + extraction schema
- Firestore:
  - `meetingJobs`
  - `meetingSummaries`
  - `meetingActionDrafts`
  - `approvalRequests`

## Data Model (Draft)
- `meetingJobs`
  - id, groupId, lineUserId, mediaType, mediaUrl, status, createdAt, updatedAt
- `meetingSummaries`
  - jobId, transcriptUrl, summaryText, highlights, decisions
- `meetingActionDrafts`
  - jobId, items[]:
    - title
    - assigneeName
    - assigneeLineUserId (optional)
    - dueDate
    - confidence
- `approvalRequests`
  - jobId, approverLineUserId, status(pending/approved/rejected), approvedAt

## Speaker / Identity Strategy
- V1 (แนะนำ): speaker diarization เป็น Speaker A/B/C แล้วให้คนแมปชื่อ
- V2: เพิ่ม voiceprint (ต้องมี consent + enrollment)
- V3: ผูกชื่อจากบริบทการพูด + participant map ในกลุ่ม

## Prompt Strategy (Meeting)
- อินพุต:
  - transcript แบบ timestamp
  - participant list (ถ้ามี)
  - รูปแบบผลลัพธ์ JSON schema
- เอาต์พุต:
  - สรุปประชุม (executive summary)
  - key decisions
  - action items
  - risks / blockers
  - open questions

## Approval Flow
- ส่ง draft งานให้หัวหน้าแผนกในกลุ่ม/DM
- ปุ่ม:
  - `ยืนยันสร้างงาน`
  - `ขอแก้ไข`
  - `ปฏิเสธ`
- หลังอนุมัติ: บันทึกงานลง TeamFlow + broadcast summary สั้น

## Security / Privacy
- เก็บไฟล์เสียงแบบ TTL (เช่น 7-30 วัน)
- เข้ารหัส at rest + signed URL
- จำกัดสิทธิ์คำสั่งอนุมัติ (เฉพาะหัวหน้า)
- audit log ทุกการอนุมัติ/แก้ไข
- แจ้งผู้ใช้เรื่องการประมวลผลเสียงและการเก็บข้อมูล

## Performance / Cost
- ไฟล์ยาว 2 ชั่วโมงต้องใช้ async queue เสมอ
- chunking audio ช่วยลด retry cost
- เก็บ transcript แทนเก็บไฟล์ดิบระยะยาว
- ตั้ง hard limit ขนาดไฟล์และเวลาสูงสุด

## Error Handling
- ไฟล์เสีย/โหลดไม่ได้ -> แจ้งส่งใหม่
- STT timeout -> retry ตาม policy
- extraction fail -> ส่ง transcript + ให้ยืนยัน manual
- create task fail -> เก็บ draft ไว้ retry ได้

## Rollout Plan
1. Milestone 1: Group command + รับไฟล์ + job status
2. Milestone 2: STT + summary draft
3. Milestone 3: action extraction + approval
4. Milestone 4: create tasks + notification
5. Milestone 5: speaker mapping + quality tuning

## Acceptance Criteria
- พิมพ์ `เรียกเลขา` แล้วตอบภายใน 3 วินาที
- รับไฟล์ประชุมและสร้าง job ได้ 100%
- สรุปพร้อม action draft สำหรับไฟล์ <= 2 ชม.
- มี approval ก่อนสร้างงานจริงทุกครั้ง
- งานที่อนุมัติแล้วถูกบันทึกเข้า TeamFlow ถูกต้อง

## Open Questions
- จะใช้ STT provider เจ้าไหน (ไทย + อังกฤษ)?
- ใช้ queue/storage ตัวไหนเป็นหลักใน production?
- policy เก็บไฟล์เสียงกี่วัน?
- ขอบเขต role หัวหน้าแผนกกำหนดจากไหน (Firestore / static list)?
