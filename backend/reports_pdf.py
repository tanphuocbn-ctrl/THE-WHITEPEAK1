"""Weekly studio report → PDF (reportlab). Vietnamese via Liberation Sans TTF."""
import io
import os
from datetime import datetime, timezone, timedelta

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

_FONT = "AppSans"
_FONT_B = "AppSans-Bold"
_registered = False


def _register_fonts():
    global _registered
    if _registered:
        return
    base = os.path.join(os.path.dirname(__file__), "assets", "fonts")
    pdfmetrics.registerFont(TTFont(_FONT, os.path.join(base, "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont(_FONT_B, os.path.join(base, "DejaVuSans-Bold.ttf")))
    _registered = True


STATUS_VI = {"todo": "Chờ làm", "in_progress": "Đang làm", "review": "Chờ duyệt",
             "rejected": "Trả hàng", "approved": "Đã duyệt", "done": "Hoàn tất"}

BLUE = colors.HexColor("#2563eb")
DARK = colors.HexColor("#18181b")
GREY = colors.HexColor("#71717a")
LIGHT = colors.HexColor("#f4f4f5")
RED = colors.HexColor("#dc2626")


def _money(n):
    try:
        return f"{int(n):,}".replace(",", ".")
    except Exception:
        return str(n)


def build_weekly_pdf(data: dict, user: dict) -> bytes:
    _register_fonts()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=16 * mm,
                            leftMargin=16 * mm, rightMargin=16 * mm, title="Báo cáo tuần")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontName=_FONT_B, fontSize=20, textColor=DARK, spaceAfter=2)
    sub = ParagraphStyle("sub", parent=ss["Normal"], fontName=_FONT, fontSize=9, textColor=GREY, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontName=_FONT_B, fontSize=12, textColor=DARK, spaceBefore=14, spaceAfter=6)
    cell = ParagraphStyle("cell", parent=ss["Normal"], fontName=_FONT, fontSize=8.5, textColor=DARK, leading=11)
    cellR = ParagraphStyle("cellR", parent=cell, alignment=2)

    now = datetime.now(timezone.utc)
    frm = now - timedelta(days=7)
    story = []

    story.append(Paragraph("Báo cáo tuần — Studio sản xuất phim", h1))
    story.append(Paragraph(
        f"Kỳ báo cáo: {frm.strftime('%d/%m/%Y')} – {now.strftime('%d/%m/%Y')} &nbsp;·&nbsp; "
        f"Người xuất: {user.get('name') or user.get('email')} &nbsp;·&nbsp; "
        f"Xuất lúc: {now.strftime('%d/%m/%Y %H:%M')} UTC", sub))
    story.append(Spacer(1, 8))

    t = data["totals"]
    kpi = [
        ["Dự án", "Version nộp", "Duyệt Đạt", "Trả hàng", "Task HK xong"],
        [str(t["projects"]), str(t["versions_week"]), str(t["approved_week"]),
         str(t["returned_week"]), str(t["post_done_week"])],
    ]
    kt = Table(kpi, colWidths=[None] * 5)
    kt.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), _FONT), ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("TEXTCOLOR", (0, 0), (-1, 0), GREY), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("FONTNAME", (0, 1), (-1, 1), _FONT_B), ("FONTSIZE", (0, 1), (-1, 1), 18),
        ("TEXTCOLOR", (0, 1), (-1, 1), BLUE), ("TOPPADDING", (0, 1), (-1, 1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6), ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
        ("LINEBELOW", (0, 1), (-1, 1), 0.5, colors.HexColor("#e4e4e7")),
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e4e4e7")),
    ]))
    story.append(kt)

    story.append(Paragraph("Phân bố trạng thái shot (toàn studio)", h2))
    sc = data["shot_status"]
    total_shots = sum(sc.values()) or 1
    srows = [["Trạng thái", "Số lượng", "Tỷ lệ"]]
    for k in ["todo", "in_progress", "review", "rejected", "approved", "done"]:
        v = sc.get(k, 0)
        srows.append([STATUS_VI.get(k, k), str(v), f"{round(v / total_shots * 100)}%"])
    st = Table(srows, colWidths=[70 * mm, 40 * mm, 40 * mm])
    st.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), _FONT_B), ("FONTNAME", (0, 1), (-1, -1), _FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 9), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 0), (-1, 0), DARK), ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e4e4e7")),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(st)

    story.append(Paragraph(f"Theo dự án ({len(data['projects'])})", h2))
    header = ["Mã", "Dự án", "Tiến độ", "Chờ duyệt", "Task HK mở", "Ngân sách (đã chi / tổng)"]
    prows = [[Paragraph(f"<b>{h}</b>", ParagraphStyle('hh', fontName=_FONT_B, fontSize=8.5, textColor=colors.white)) for h in header]]
    for p in data["projects"]:
        if p["budget"] > 0:
            bud = f"{_money(p['spent'])} / {_money(p['budget'])}"
            if p["over"]:
                bud += "  ⚠ VƯỢT"
        else:
            bud = "—"
        prows.append([
            Paragraph(p["code"], cell), Paragraph(p["title"], cell),
            Paragraph(f"{p['progress']}%", cellR), Paragraph(str(p["review"]), cellR),
            Paragraph(str(p["post_open"]), cellR),
            Paragraph(bud, ParagraphStyle('b', parent=cellR, textColor=RED if p["over"] else DARK)),
        ])
    pt = Table(prows, colWidths=[16 * mm, 52 * mm, 18 * mm, 20 * mm, 22 * mm, 50 * mm], repeatRows=1)
    pt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK), ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e4e4e7")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(pt)

    story.append(Spacer(1, 16))
    story.append(Paragraph("Tài liệu nội bộ — Hệ thống Quản lý Sản xuất Phim Tập trung.",
                           ParagraphStyle("foot", fontName=_FONT, fontSize=7.5, textColor=GREY)))

    doc.build(story)
    return buf.getvalue()
