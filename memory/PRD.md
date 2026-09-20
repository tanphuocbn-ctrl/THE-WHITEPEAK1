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

## Backlog
- P1: Script diff selective confirm (checkbox per scene); scene detail edit UI; shot edit/delete UI.
- P1: Download token instead of ?auth= JWT in URL; temp-file cleanup on failed upload.
- P2 (Phase 2): Canvas single-user infinite board; shared project resource library; AI/OCR multi-provider script import (OpenAI/Gemini/Claude adapter).
- P3 (Phase 3): Hậu kỳ per-sequence tasks + external ingest manifest; Skill library; staffing/budget; weekly reports.

## Next tasks
Gather feedback on Phase 1, then start Phase 2 Canvas or deepen script diff / review video player.
