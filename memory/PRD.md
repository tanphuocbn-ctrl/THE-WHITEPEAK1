# PRD — Hệ thống Quản lý Sản xuất Phim Tập trung

## Problem statement (original)
Nền tảng web tập trung: kịch bản → scene/shot → phân công → sản xuất → duyệt/trả hàng → hậu kỳ, phân quyền theo vai trò, lịch sử/version đầy đủ. Kiểm quyền server-side mọi tầng; version bất biến; chống lost-update bằng revision/ETag; không render video; Canvas v1 single-user.

## Architecture
- Frontend: React (JS/JSX) + Tailwind + shadcn/ui, dark theme (Manrope/IBM Plex Sans/JetBrains Mono), react-router, axios (cookie auth), sonner.
- Backend: FastAPI modular (routers/), MongoDB (motor). All routes under /api.
- Auth: JWT httpOnly cookies (access 15m + refresh 7d) + full password reset (Emergent email). Bcrypt, brute-force lockout, token_version.
- RBAC: system roles (super_admin/secretary/skill_manager/member) + project roles (pm/team_lead/member/editor/reviewer/guest); capability matrix enforced server-side (rbac.py require_cap).
- Concurrency: integer `rev` on projects/sequences/scenes/shots; updates require matching rev → else 409 (common.check_rev).
- Media: Emergent S3-compatible Object Storage; resumable chunked upload (init/chunk/complete) to disk then storage; immutable versions.
- Audit: audit_logs on every mutation with before/after + restore endpoint.

## User personas
Super Admin/Studio Owner, Thư ký, PM/Team Lead, Member, Reviewer, Editor, Skill Manager, Guest.

## Core requirements (static)
Phase 1 spine: Auth+RBAC; Project/Sequence/Scene/Shot CRUD; script import (DOCX/PDF/manual → staging → diff → confirm, additive); assignment (assignee/deadline/status, kanban); immutable versioning + resumable upload; review Đạt/Không đạt kèm timecode + return/resubmit; audit + restore.

## Implemented (2026-06)
- [x] JWT auth + password reset + brute force + seeding (admin=tanphuoc.bn@gmail.com)
- [x] RBAC capability matrix, server-side enforcement
- [x] Project CRUD + members (grant/revoke), scoped listing
- [x] Sequence/Scene/Shot CRUD with optimistic concurrency
- [x] Script import: manual + DOCX/PDF/TXT extract → staging → diff → confirm (no overwrite)
- [x] Assignment + status + kanban board (mine/all)
- [x] Immutable versioning + resumable chunked upload + authenticated download; selection-generation guard
- [x] Review pass/fail + timecode comments + returns list; stale-version 409 guard (force)
- [x] Audit log timeline + restore
- [x] Dashboard aggregation
- [x] Seed demo data (DEMO-01, 6 role users)
- Verified: testing agent 27/27 backend, all frontend flows.

## Implemented (2026-06, iter 2 — 4 tính năng mở rộng)
- [x] Video Player khi duyệt: trình phát video trong panel duyệt, click timecode để tua, nút "lấy thời điểm hiện tại", tua từ lịch sử phản hồi (ShotSheet ReviewTab). Download endpoint nay chấp nhận cookie auth.
- [x] Chọn scene khi import: bước diff có checkbox cho từng cảnh mới, confirm chỉ tạo cảnh đã chọn (additive, không ghi đè).
- [x] AI import kịch bản: adapter đa provider qua Emergent Universal Key — mặc định Gemini 3.1 Pro (openai/anthropic tuỳ chọn), ghi provider+model+chi phí, fallback nhập tay khi lỗi.
- [x] Canvas single-user (Phase 2): bảng vô hạn pan/zoom, node scene/shot/nhân vật/bối cảnh/media/ghi chú, kéo thả, nối cạnh, undo/redo, sửa inline + màu, lưu (optimistic concurrency rev), snapshot lưu/khôi phục.
- Verified: testing agent 14/14 backend Phase 2, frontend Canvas/Script-AI/Review đạt.

## Implemented (2026-06, iter 3 — Canvas nâng cao)
- [x] Xuất Canvas PNG: nút "PNG" render toàn bảng (đo kích thước node thật từ DOM, vẽ node + cạnh + ảnh media) → tải file `canvas-<code>-<ts>.png`.
- [x] Node Media có ảnh: upload ảnh cho node Media (endpoint `POST /canvas/media`, serve qua `GET /canvas/media/{id}` cookie auth) → hiển thị thumbnail ngay trên canvas và trong PNG xuất.
- [x] Đồng bộ tên node: khi đổi code/title của scene/shot, tiêu đề mọi node canvas tham chiếu (ref_id) tự cập nhật (`common.sync_ref_nodes` gọi trong update scene/shot).
- Verified: curl (media upload/serve, rename→node sync) + frontend E2E (media preview, PNG export toast).

## Backlog
- P1: Script diff selective confirm (checkbox per scene); scene detail edit UI; shot edit/delete UI.
- P1: Download token instead of ?auth= JWT in URL; temp-file cleanup on failed upload.
- P2 (Phase 2): Canvas single-user infinite board; shared project resource library; AI/OCR multi-provider script import (OpenAI/Gemini/Claude adapter).
- P3 (Phase 3): Hậu kỳ per-sequence tasks + external ingest manifest; Skill library; staffing/budget; weekly reports.

## Next tasks
Gather feedback on Phase 1, then start Phase 2 Canvas or deepen script diff / review video player.
