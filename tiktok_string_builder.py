#!/usr/bin/env python3
"""TikTok String Builder — сборщик + расписание + пакетная загрузка папки"""

from __future__ import annotations
import json, sys, urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from PySide6.QtCore import Qt, QDateTime, QThread, Signal, QTime
from PySide6.QtGui  import (QGuiApplication, QIcon, QPixmap, QPainter,
                             QColor, QFont, QBrush, QShortcut)
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QDateTimeEdit, QFileDialog,
    QHBoxLayout, QLabel, QLineEdit, QMainWindow, QMessageBox,
    QPlainTextEdit, QPushButton, QStatusBar, QVBoxLayout, QWidget,
    QScrollArea, QFrame, QTabWidget, QSpinBox, QTimeEdit,
    QListWidget, QListWidgetItem, QAbstractItemView, QStackedWidget,
    QSizePolicy, QGridLayout,
)

BG     = "#0a0c0c"
SURF   = "#0f1515"
SURF2  = "#131d1d"
BORDER = "#1c2e2e"
TEXT   = "#b8d8d0"
MUTED  = "#3a5858"
TEAL   = "#00e5c0"
TEAL_D = "#009980"
TEAL_B = "#001e18"
ERR    = "#ff4060"
WARN   = "#e5a000"

QSS = """
QWidget{background:#0a0c0c;color:#b8d8d0;font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;border:none;}
QMainWindow{background:#0a0c0c;}
QScrollArea,QScrollArea>QWidget>QWidget{background:#0a0c0c;border:none;}
QScrollBar:vertical{background:#0a0c0c;width:4px;}
QScrollBar::handle:vertical{background:#1c2e2e;border-radius:2px;min-height:20px;}
QScrollBar::add-line:vertical,QScrollBar::sub-line:vertical{height:0;}

QTabWidget::pane{border:none;background:#0a0c0c;}
QTabBar{background:#0a0c0c;}
QTabBar::tab{background:transparent;color:#3a5858;font-size:12px;font-weight:600;
    padding:8px 18px;border:none;border-bottom:2px solid transparent;margin-right:2px;}
QTabBar::tab:selected{color:#00e5c0;border-bottom:2px solid #00e5c0;}
QTabBar::tab:hover:!selected{color:#b8d8d0;}

QLineEdit,QPlainTextEdit,QDateTimeEdit,QComboBox,QTimeEdit{
    background:#0f1515;border:1px solid #1c2e2e;border-radius:7px;
    padding:7px 10px;color:#b8d8d0;selection-background-color:#009980;}
QLineEdit:focus,QPlainTextEdit:focus,QDateTimeEdit:focus,QTimeEdit:focus{
    border-color:#009980;background:#131d1d;}
QLineEdit::placeholder{color:#3a5858;}
QComboBox::drop-down{border:none;width:20px;}
QComboBox::down-arrow{border-left:4px solid transparent;border-right:4px solid transparent;
    border-top:4px solid #3a5858;margin-right:8px;}
QComboBox QAbstractItemView{background:#131d1d;color:#b8d8d0;border:1px solid #1c2e2e;
    selection-background-color:#001e18;selection-color:#00e5c0;}
QDateTimeEdit::up-button,QDateTimeEdit::down-button,
QTimeEdit::up-button,QTimeEdit::down-button{background:transparent;border:none;width:14px;}
QSpinBox{background:#0f1515;border:1px solid #1c2e2e;border-radius:7px;
    padding:4px 8px;color:#b8d8d0;min-width:52px;}
QSpinBox:focus{border-color:#009980;background:#131d1d;}
QSpinBox::up-button,QSpinBox::down-button{background:transparent;border:none;width:14px;}

QPushButton{background:transparent;color:#3a5858;border:1px solid #1c2e2e;
    border-radius:7px;padding:8px 16px;font-weight:600;font-size:12px;}
QPushButton:hover{color:#b8d8d0;border-color:#2a4040;background:#0f1515;}
QPushButton:pressed{background:#131d1d;}
QPushButton:disabled{opacity:0.35;}
QPushButton#Primary{background:#00e5c0;color:#001810;border:none;
    font-size:13px;font-weight:700;padding:10px 24px;border-radius:8px;}
QPushButton#Primary:hover{background:#00f0ca;}
QPushButton#Primary:pressed{background:#009980;}
QPushButton#Danger{background:transparent;color:#ff4060;border:1px solid #3a1020;
    border-radius:7px;font-size:12px;font-weight:600;padding:6px 14px;}
QPushButton#Danger:hover{background:#1a0810;border-color:#ff4060;}

QCheckBox{color:#3a5858;font-size:12px;spacing:6px;}
QCheckBox::indicator{width:16px;height:16px;border:1px solid #1c2e2e;border-radius:4px;background:#0f1515;}
QCheckBox::indicator:checked{background:#00e5c0;border-color:#00e5c0;}
QCheckBox::indicator:hover{border-color:#009980;}

QStatusBar{background:#0f1515;color:#3a5858;font-size:11px;padding:2px 10px;border-top:1px solid #1c2e2e;}
QLabel#BridgeOk{color:#00e5c0;font-size:11px;font-weight:600;}
QLabel#BridgeErr{color:#ff4060;font-size:11px;font-weight:600;}
QLabel#BridgeWait{color:#3a5858;font-size:11px;font-weight:600;}

QPlainTextEdit#Preview{background:#060e0e;border:1px solid #1c2e2e;border-radius:7px;
    color:#00e5c0;font-family:'Consolas','Courier New',monospace;font-size:12px;padding:8px 10px;}
QPlainTextEdit#Preview:focus{border-color:#009980;}
QFrame#Line{background:#1c2e2e;max-height:1px;min-height:1px;border:none;}

QListWidget{background:#0f1515;border:1px solid #1c2e2e;border-radius:8px;
    padding:4px;color:#b8d8d0;font-size:11px;}
QListWidget::item{padding:5px 8px;border-radius:5px;border:none;}
QListWidget::item:selected{background:#001e18;color:#00e5c0;}
QListWidget::item:hover{background:#0d1e1e;}
QLabel#Stat{font-size:11px;color:#3a5858;}
QLabel#BWarn{font-size:11px;color:#e5a000;font-weight:600;}
QLabel#BOk{font-size:11px;color:#00e5c0;font-weight:600;}

QPushButton#CardBtn{
    background:#0f1515;border:1px solid #1c2e2e;border-radius:7px;
    color:#b8d8d0;font-family:'Consolas','Courier New',monospace;font-size:11px;
    font-weight:400;padding:7px 12px;text-align:left;}
QPushButton#CardBtn:hover{background:#0d1e1e;border-color:#2a4040;}
QPushButton#CardBtnDone{
    background:#001e18;border:1px solid #009980;border-radius:7px;
    color:#00e5c0;font-family:'Consolas','Courier New',monospace;font-size:11px;
    font-weight:400;padding:7px 12px;text-align:left;}
QPushButton#CardBtnDone:hover{background:#002820;}
"""

CONFIG_DIR    = Path.home() / ".tiktok_bridge"
CONFIG_FILE   = CONFIG_DIR / "string_builder.json"
BRIDGE_URL    = "http://127.0.0.1:8765"
VIDEO_EXTS    = {".mp4",".mov",".avi",".mkv",".webm",".m4v",".mpg",".mpeg"}
HISTORY_LIMIT = 10
DAYS_RU       = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"]
DAYS_EN       = ["mon","tue","wed","thu","fri","sat","sun"]
MAX_SLOTS     = 8
MIN_AHEAD_MIN = 30

def load_config():
    try:
        if CONFIG_FILE.is_file():
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except: pass
    return {"last_path":"","last_tags":"","last_caption":"","history":[],"schedule":{}}

def save_config(cfg):
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    except: pass

class BridgePing(QThread):
    result = Signal(bool, str)
    def run(self):
        try:
            with urllib.request.urlopen(BRIDGE_URL+"/health", timeout=3) as r:
                self.result.emit(r.status==200,"ok" if r.status==200 else f"HTTP {r.status}")
        except Exception as e:
            self.result.emit(False, str(e))

def make_icon():
    pm=QPixmap(48,48); pm.fill(QColor(BG))
    p=QPainter(pm); p.setRenderHint(QPainter.Antialiasing)
    p.setBrush(QBrush(QColor(TEAL))); p.setPen(Qt.NoPen)
    p.drawRoundedRect(4,4,40,40,10,10)
    p.setPen(QColor("#001810"))
    f=QFont("Segoe UI",16,QFont.Bold); p.setFont(f)
    p.drawText(pm.rect(),Qt.AlignCenter,"TT")
    p.end(); return QIcon(pm)

def sep():
    f=QFrame(); f.setObjectName("Line"); f.setFixedHeight(1); return f

def clbl(text):
    l=QLabel(text); l.setStyleSheet(f"font-size:11px;color:{MUTED};"); return l

def build_slots_from_schedule(schedule: dict, n_videos: int) -> list[datetime]:
    now = datetime.now()
    earliest = now + timedelta(minutes=MIN_AHEAD_MIN)
    result: list[datetime] = []
    cur = earliest.replace(hour=0, minute=0, second=0, microsecond=0)
    for _ in range(90):
        day_key = DAYS_EN[cur.weekday()]
        day_data = schedule.get(day_key, {})
        if day_data.get("enabled"):
            times = day_data.get("times", [])
            count = day_data.get("count", 0)
            for t_str in times[:count]:
                try: hh, mm = map(int, t_str.split(":"))
                except: continue
                slot_dt = cur.replace(hour=hh, minute=mm, second=0, microsecond=0)
                if slot_dt >= earliest:
                    result.append(slot_dt)
                    if len(result) >= n_videos: return result
        cur += timedelta(days=1)
    return result


# ── DayRow — compact horizontal design ───────────────────────────────────────
class DayRow(QWidget):
    def __init__(self, day_key, day_ru, saved, parent=None):
        super().__init__(parent)
        self.day_key = day_key
        self._slots: list[QTimeEdit] = []

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 4)
        outer.setSpacing(0)

        # ── card frame ────────────────────────────────────────────────
        self.card = QFrame()
        self.card.setStyleSheet(
            f"QFrame{{background:{SURF};border:1px solid {BORDER};"
            f"border-radius:10px;}}")
        outer.addWidget(self.card)

        vlay = QVBoxLayout(self.card)
        vlay.setContentsMargins(12, 8, 12, 10)
        vlay.setSpacing(6)

        # ── header row ────────────────────────────────────────────────
        hdr = QHBoxLayout(); hdr.setSpacing(8)

        self.chk = QCheckBox()
        self.chk.stateChanged.connect(self._on_toggle)

        self.day_lbl = QLabel(day_ru)
        self.day_lbl.setStyleSheet(
            f"font-size:13px;font-weight:700;color:{TEXT};min-width:26px;")

        hdr.addWidget(self.chk)
        hdr.addWidget(self.day_lbl)
        hdr.addStretch()

        cnt_lbl = QLabel("роликов:")
        cnt_lbl.setStyleSheet(f"font-size:11px;color:{MUTED};")
        self.spin = QSpinBox()
        self.spin.setRange(0, MAX_SLOTS)
        self.spin.setFixedWidth(54)
        self.spin.setFixedHeight(28)
        self.spin.valueChanged.connect(self._on_count)
        hdr.addWidget(cnt_lbl)
        hdr.addWidget(self.spin)
        vlay.addLayout(hdr)

        # ── slots container (hidden when count=0) ──────────────────────
        self.slots_w = QWidget()
        self.slots_flow = QHBoxLayout(self.slots_w)
        self.slots_flow.setContentsMargins(0, 0, 0, 0)
        self.slots_flow.setSpacing(6)
        vlay.addWidget(self.slots_w)

        # restore
        times   = saved.get("times", [])
        count   = saved.get("count", 0)
        enabled = saved.get("enabled", False)

        self.spin.blockSignals(True)
        self.spin.setValue(count)
        self.spin.blockSignals(False)
        self._rebuild(count, times)

        self.chk.blockSignals(True)
        self.chk.setChecked(enabled)
        self.chk.blockSignals(False)
        self._apply(enabled)

    def _on_toggle(self, s): self._apply(bool(s))

    def _apply(self, en: bool):
        self.spin.setEnabled(en)
        self.slots_w.setEnabled(en)
        color = TEAL_D if en else BORDER
        bg    = "#0d1e1e" if en else SURF
        self.card.setStyleSheet(
            f"QFrame{{background:{bg};border:1px solid {color};"
            f"border-radius:10px;}}")

    def _on_count(self, n):
        times = [t.time().toString("HH:mm") for t in self._slots]
        self._rebuild(n, times)

    def _rebuild(self, n: int, times: list[str]):
        # clear
        while self.slots_flow.count():
            it = self.slots_flow.takeAt(0)
            if it.widget(): it.widget().deleteLater()
        self._slots.clear()

        # rows of 4 inside a vertical layout
        # we replace the single HBoxLayout with nested VBox + rows
        # simpler: use a grid
        grid_w = QWidget()
        grid = QGridLayout(grid_w)
        grid.setContentsMargins(0, 0, 0, 0)
        grid.setHorizontalSpacing(6)
        grid.setVerticalSpacing(4)

        for i in range(n):
            col_pair = (i % 4) * 2   # 0,2,4,6
            row_idx  = i // 4

            num = QLabel(f"{i+1}.")
            num.setStyleSheet(f"font-size:10px;color:{MUTED};")
            num.setFixedWidth(16)
            num.setAlignment(Qt.AlignRight | Qt.AlignVCenter)

            te = QTimeEdit()
            te.setDisplayFormat("HH:mm")
            te.setFixedWidth(76)
            te.setFixedHeight(28)
            if i < len(times):
                te.setTime(QTime.fromString(times[i], "HH:mm"))
            else:
                te.setTime(QTime(10 + i, 0))

            grid.addWidget(num, row_idx, col_pair)
            grid.addWidget(te,  row_idx, col_pair + 1)
            self._slots.append(te)

        # fill remaining cells in last row with spacers so alignment is consistent
        if n > 0:
            last_row = (n - 1) // 4
            used_in_last = n % 4 or 4
            for c in range(used_in_last, 4):
                sp = QWidget(); sp.setFixedWidth(76 + 16 + 6)
                grid.addWidget(sp, last_row, c * 2, 1, 2)

        self.slots_flow.addWidget(grid_w)
        self.slots_flow.addStretch()
        self.slots_w.setVisible(n > 0)

    def get_data(self) -> dict:
        return {
            "enabled": self.chk.isChecked(),
            "count":   self.spin.value(),
            "times":   [t.time().toString("HH:mm") for t in self._slots],
        }


# ── WrappingButton — QPushButton с переносом текста ──────────────────────────
class WrappingButton(QPushButton):
    """QPushButton с авто-переносом длинного текста."""
    _CSS_NORMAL = (f"background:transparent;border:none;padding:0;"
                   f"font-family:'Consolas','Courier New',monospace;"
                   f"font-size:11px;color:{TEXT};")
    _CSS_DONE   = (f"background:transparent;border:none;padding:0;"
                   f"font-family:'Consolas','Courier New',monospace;"
                   f"font-size:11px;color:{TEAL};")

    def __init__(self, text="", parent=None):
        super().__init__(parent)
        self._lbl = QLabel(text, self)
        self._lbl.setWordWrap(True)
        self._lbl.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        self._lbl.setStyleSheet(self._CSS_NORMAL)
        self._lbl.setAttribute(Qt.WA_TransparentForMouseEvents)
        self.setText("")
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)

    def set_label(self, text: str):
        self._lbl.setText(text)
        self._update_lbl_geom()

    def set_done(self):
        self._lbl.setStyleSheet(self._CSS_DONE)
        self.setObjectName("CardBtnDone")
        self.style().unpolish(self); self.style().polish(self)

    def resizeEvent(self, e):
        super().resizeEvent(e)
        self._update_lbl_geom()

    def _update_lbl_geom(self):
        m = 12
        w = max(self.width() - m * 2, 10)
        self._lbl.setFixedWidth(w)
        self._lbl.adjustSize()
        h = max(self._lbl.sizeHint().height() + 16, 38)
        self._lbl.setGeometry(m, 8, w, h - 16)
        self.setMinimumHeight(h)
        self.setMaximumHeight(h)


# ── main window ───────────────────────────────────────────────────────────────
class StringBuilder(QMainWindow):
    def __init__(self):
        super().__init__()
        self.cfg = load_config()
        self.ping_thread = None
        self.day_rows: list[DayRow] = []
        self._batch_files: list[Path] = []
        self._batch_strings: list[str] = []
        self._card_btns: list[WrappingButton] = []

        self.setWindowTitle("TT String Builder")
        self.setWindowIcon(make_icon())
        self.resize(560, 720)
        self.setMinimumSize(460, 560)
        self.status = QStatusBar(); self.setStatusBar(self.status)

        tabs = QTabWidget(); tabs.setDocumentMode(True)
        self.setCentralWidget(tabs)
        tabs.addTab(self._tab_builder(),  "Одно видео")
        tabs.addTab(self._tab_schedule(), "Расписание")
        tabs.addTab(self._tab_batch(),    "Папка")

    # ══════════════════════════════════════════════════════════════════════
    # TAB 1
    # ══════════════════════════════════════════════════════════════════════
    def _tab_builder(self):
        scroll = QScrollArea(); scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        w = QWidget(); scroll.setWidget(w)
        root = QVBoxLayout(w); root.setContentsMargins(20,16,20,16); root.setSpacing(12)

        hdr = QHBoxLayout()
        t = QLabel("TT String Builder")
        t.setStyleSheet("font-size:15px;font-weight:700;color:#fff;letter-spacing:.2px;")
        hdr.addWidget(t, 1)
        self.bridge_label = QLabel("Bridge…"); self.bridge_label.setObjectName("BridgeWait")
        self.bridge_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        hdr.addWidget(self.bridge_label); root.addLayout(hdr); root.addWidget(sep())

        root.addWidget(clbl("Путь к видео"))
        pr = QHBoxLayout(); pr.setSpacing(8)
        self.path_edit = QLineEdit(); self.path_edit.setPlaceholderText(r"C:\Videos\clip.mp4")
        self.path_edit.setText(self.cfg.get("last_path",""))
        br = QPushButton("Обзор"); br.setFixedWidth(76); br.clicked.connect(self._browse_file)
        pr.addWidget(self.path_edit, 1); pr.addWidget(br); root.addLayout(pr)

        root.addWidget(clbl("Хештеги"))
        self.tags_edit = QLineEdit(); self.tags_edit.setPlaceholderText("#cats #funny #pet")
        self.tags_edit.setText(self.cfg.get("last_tags","")); root.addWidget(self.tags_edit)

        root.addWidget(clbl("Описание  ·  если пусто — берётся имя файла"))
        self.caption_edit = QPlainTextEdit(); self.caption_edit.setPlaceholderText("Опционально…")
        self.caption_edit.setFixedHeight(54)
        self.caption_edit.setPlainText(self.cfg.get("last_caption","")); root.addWidget(self.caption_edit)

        dr = QHBoxLayout(); dr.setSpacing(10)
        self.date_check = QCheckBox("Запланировать")
        self.date_check.stateChanged.connect(lambda s: self.date_edit.setEnabled(bool(s)))
        self.date_edit = QDateTimeEdit(); self.date_edit.setDisplayFormat("yyyy-MM-dd HH:mm")
        self.date_edit.setCalendarPopup(True)
        self.date_edit.setDateTime(QDateTime.currentDateTime().addSecs(3600))
        self.date_edit.setEnabled(False)
        dr.addWidget(self.date_check); dr.addWidget(self.date_edit, 1); root.addLayout(dr)

        root.addWidget(sep()); root.addWidget(clbl("Готовая строка"))
        self.preview = QPlainTextEdit(); self.preview.setObjectName("Preview")
        self.preview.setReadOnly(True); self.preview.setFixedHeight(58)
        self.preview.setPlaceholderText("Нажми Собрать или Скопировать…"); root.addWidget(self.preview)

        brow = QHBoxLayout(); brow.setSpacing(8)
        bb = QPushButton("Собрать"); bb.clicked.connect(self.build_string)
        self.copy_btn = QPushButton("Скопировать"); self.copy_btn.setObjectName("Primary")
        self.copy_btn.clicked.connect(self.copy_string)
        cb = QPushButton("Очистить"); cb.clicked.connect(self.clear_all)
        brow.addWidget(bb,2); brow.addWidget(self.copy_btn,3); brow.addWidget(cb,1)
        root.addLayout(brow); root.addWidget(sep())

        root.addWidget(clbl("История"))
        self.history_combo = QComboBox()
        self.history_combo.addItem("— выбери прошлую строку —","")
        for s in self.cfg.get("history",[]): self.history_combo.addItem(self._short(s),s)
        self.history_combo.currentIndexChanged.connect(self.on_history)
        root.addWidget(self.history_combo)

        pingr = QHBoxLayout(); pingr.addStretch()
        pb = QPushButton("Проверить Bridge")
        pb.setStyleSheet(f"font-size:11px;padding:4px 12px;color:{MUTED};")
        pb.clicked.connect(self.ping_bridge); pingr.addWidget(pb)
        root.addLayout(pingr); root.addStretch()

        QShortcut("Ctrl+B",      w, self.build_string)
        QShortcut("Ctrl+Return", w, self.copy_string)
        self.ping_bridge()
        return scroll

    # ══════════════════════════════════════════════════════════════════════
    # TAB 2
    # ══════════════════════════════════════════════════════════════════════
    def _tab_schedule(self):
        scroll = QScrollArea(); scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        w = QWidget(); scroll.setWidget(w)
        root = QVBoxLayout(w); root.setContentsMargins(20,16,20,16); root.setSpacing(8)

        hdr = QHBoxLayout()
        t = QLabel("Расписание публикаций")
        t.setStyleSheet("font-size:15px;font-weight:700;color:#fff;letter-spacing:.2px;")
        hdr.addWidget(t, 1)
        sv = QPushButton("Сохранить"); sv.setObjectName("Primary"); sv.setFixedHeight(32)
        sv.clicked.connect(self.save_schedule); hdr.addWidget(sv); root.addLayout(hdr)

        hint = QLabel("Включи нужные дни, укажи количество роликов и время каждой публикации.")
        hint.setStyleSheet(f"font-size:11px;color:{MUTED};"); hint.setWordWrap(True)
        root.addWidget(hint); root.addWidget(sep())

        saved = self.cfg.get("schedule", {})
        for key, ru in zip(DAYS_EN, DAYS_RU):
            row = DayRow(key, ru, saved.get(key, {}))
            self.day_rows.append(row); root.addWidget(row)

        root.addWidget(sep())
        bot = QHBoxLayout(); bot.setSpacing(8)
        cs = QPushButton("Скопировать расписание"); cs.clicked.connect(self.copy_schedule_text)
        rs = QPushButton("Сбросить всё"); rs.clicked.connect(self.reset_schedule)
        bot.addWidget(cs,2); bot.addWidget(rs,1); root.addLayout(bot)
        root.addStretch()
        return scroll

    # ══════════════════════════════════════════════════════════════════════
    # TAB 3
    # ══════════════════════════════════════════════════════════════════════
    def _tab_batch(self):
        scroll = QScrollArea(); scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        w = QWidget(); scroll.setWidget(w)
        root = QVBoxLayout(w); root.setContentsMargins(20,16,20,16); root.setSpacing(12)

        t = QLabel("Пакетная загрузка папки")
        t.setStyleSheet("font-size:15px;font-weight:700;color:#fff;letter-spacing:.2px;")
        root.addWidget(t)
        hint = QLabel(f"Выбери папку с видео — даты и тайминги подставятся из расписания.\n"
                      f"Первая публикация не раньше чем через {MIN_AHEAD_MIN} минут от текущего времени.")
        hint.setStyleSheet(f"font-size:11px;color:{MUTED};"); hint.setWordWrap(True)
        root.addWidget(hint); root.addWidget(sep())

        root.addWidget(clbl("Папка с видео"))
        folrow = QHBoxLayout(); folrow.setSpacing(8)
        self.folder_edit = QLineEdit()
        self.folder_edit.setPlaceholderText("C:\\Videos\\batch")
        self.folder_edit.setReadOnly(True)
        fb = QPushButton("Выбрать папку"); fb.clicked.connect(self._pick_folder)
        folrow.addWidget(self.folder_edit, 1); folrow.addWidget(fb); root.addLayout(folrow)

        root.addWidget(clbl("Хештеги для всех видео"))
        self.batch_tags = QLineEdit(); self.batch_tags.setPlaceholderText("#cats #funny #pet")
        self.batch_tags.setText(self.cfg.get("last_tags","")); root.addWidget(self.batch_tags)

        root.addWidget(sep())

        lhdr = QHBoxLayout(); lhdr.addWidget(clbl("Видеофайлы в папке")); lhdr.addStretch()
        self.batch_count_lbl = QLabel(""); self.batch_count_lbl.setObjectName("Stat")
        lhdr.addWidget(self.batch_count_lbl); root.addLayout(lhdr)
        self.file_list = QListWidget()
        self.file_list.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.file_list.setMinimumHeight(120); root.addWidget(self.file_list)
        rm_row = QHBoxLayout(); rm_row.addStretch()
        rm_btn = QPushButton("Убрать выбранные"); rm_btn.setObjectName("Danger")
        rm_btn.setFixedHeight(28); rm_btn.clicked.connect(self._remove_selected)
        rm_row.addWidget(rm_btn); root.addLayout(rm_row); root.addWidget(sep())

        phdr = QHBoxLayout()
        phdr.addWidget(clbl("Предпросмотр строк")); phdr.addStretch()
        self._btn_view_text  = QPushButton("Текст");  self._btn_view_text.setFixedSize(64,26)
        self._btn_view_cards = QPushButton("Кнопки"); self._btn_view_cards.setFixedSize(64,26)
        self._btn_view_text.clicked.connect(lambda: self._set_preview_mode(0))
        self._btn_view_cards.clicked.connect(lambda: self._set_preview_mode(1))
        phdr.addWidget(self._btn_view_text); phdr.addWidget(self._btn_view_cards)
        root.addLayout(phdr)

        self._preview_stack = QStackedWidget()

        self.batch_preview = QPlainTextEdit(); self.batch_preview.setObjectName("Preview")
        self.batch_preview.setReadOnly(True); self.batch_preview.setMinimumHeight(160)
        self.batch_preview.setPlaceholderText("Нажми «Сгенерировать» чтобы увидеть строки…")
        self._preview_stack.addWidget(self.batch_preview)

        cards_outer = QScrollArea(); cards_outer.setWidgetResizable(True)
        cards_outer.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        cards_outer.setMinimumHeight(160)
        cards_outer.setStyleSheet(
            "QScrollArea{background:#0a0c0c;border:1px solid #1c2e2e;border-radius:7px;}"
            "QScrollArea>QWidget>QWidget{background:#0a0c0c;}")
        self._cards_widget = QWidget()
        self._cards_layout = QVBoxLayout(self._cards_widget)
        self._cards_layout.setContentsMargins(6,6,6,6); self._cards_layout.setSpacing(4)
        self._cards_layout.addStretch()
        cards_outer.setWidget(self._cards_widget)
        self._preview_stack.addWidget(cards_outer)

        root.addWidget(self._preview_stack)
        self._set_preview_mode(0)

        self.batch_warn = QLabel(""); self.batch_warn.setObjectName("Stat")
        self.batch_warn.setWordWrap(True); root.addWidget(self.batch_warn)

        arow = QHBoxLayout(); arow.setSpacing(8)
        gen_btn = QPushButton("⟳  Сгенерировать"); gen_btn.clicked.connect(self._generate_batch)
        self.copy_batch_btn = QPushButton("Скопировать все строки")
        self.copy_batch_btn.setObjectName("Primary"); self.copy_batch_btn.clicked.connect(self._copy_batch)
        arow.addWidget(gen_btn,2); arow.addWidget(self.copy_batch_btn,3)
        root.addLayout(arow); root.addStretch()
        return scroll

    _ACTIVE_TOGGLE   = (f"font-size:11px;font-weight:700;border-radius:5px;padding:2px 8px;"
                        f"background:{TEAL};color:#001810;border:none;")
    _INACTIVE_TOGGLE = (f"font-size:11px;font-weight:600;border-radius:5px;padding:2px 8px;"
                        f"background:transparent;color:{MUTED};border:1px solid {BORDER};")

    def _set_preview_mode(self, idx: int):
        self._preview_stack.setCurrentIndex(idx)
        self._btn_view_text.setStyleSheet(self._ACTIVE_TOGGLE if idx==0 else self._INACTIVE_TOGGLE)
        self._btn_view_cards.setStyleSheet(self._ACTIVE_TOGGLE if idx==1 else self._INACTIVE_TOGGLE)

    def _pick_folder(self):
        folder = QFileDialog.getExistingDirectory(self,"Выбери папку с видео",str(Path.home()))
        if not folder: return
        self.folder_edit.setText(folder); self._load_folder(Path(folder))

    def _load_folder(self, folder: Path):
        files = sorted(p for p in folder.iterdir()
                       if p.is_file() and p.suffix.lower() in VIDEO_EXTS)
        self._batch_files = files; self.file_list.clear()
        for f in files:
            item = QListWidgetItem(f.name); item.setData(Qt.UserRole, str(f))
            self.file_list.addItem(item)
        n = len(files)
        self.batch_count_lbl.setText(f"{n} файл{'ов' if n!=1 else ''}")
        self.batch_preview.clear(); self.batch_warn.setText("")
        self._batch_strings = []; self._rebuild_cards([])

    def _remove_selected(self):
        sel = {item.data(Qt.UserRole) for item in self.file_list.selectedItems()}
        self._batch_files = [f for f in self._batch_files if str(f) not in sel]
        for item in self.file_list.selectedItems():
            self.file_list.takeItem(self.file_list.row(item))
        n = len(self._batch_files)
        self.batch_count_lbl.setText(f"{n} файл{'ов' if n!=1 else ''}")
        self.batch_preview.clear(); self.batch_warn.setText("")
        self._batch_strings = []; self._rebuild_cards([])

    def _rebuild_cards(self, lines: list[str]):
        while self._cards_layout.count() > 1:
            it = self._cards_layout.takeAt(0)
            if it.widget(): it.widget().deleteLater()
        self._card_btns.clear()

        for i, line in enumerate(lines):
            parts = [p.strip() for p in line.split("|")]
            fname = Path(parts[0]).name if parts else line
            date  = parts[2].strip() if len(parts) > 2 else ""
            # full display: number + filename + date
            display = f"{i+1}.  {fname}"
            if date: display += f"\n         {date}"

            btn = WrappingButton()
            btn.setObjectName("CardBtn")
            btn.set_label(display)
            btn.setToolTip(line)

            def make_handler(b: WrappingButton, full: str, short: str):
                def _h():
                    QGuiApplication.clipboard().setText(full)
                    b.set_label("✓  " + short)
                    b.set_done()
                    idx = self._card_btns.index(b)
                    self.status.showMessage(f"Строка {idx+1} скопирована.", 2000)
                return _h
            btn.clicked.connect(make_handler(btn, line, display))
            self._cards_layout.insertWidget(self._cards_layout.count()-1, btn)
            self._card_btns.append(btn)

    def _generate_batch(self):
        files = self._batch_files
        if not files:
            self._set_warn("⚠ Сначала выбери папку с видео.", "BWarn"); return

        # take schedule DIRECTLY from widgets (no need to save first)
        schedule = self._get_schedule_data()
        active = [k for k in DAYS_EN if schedule.get(k,{}).get("enabled")]
        if not active:
            self._set_warn("⚠ Нет активных дней в расписании. Включи хотя бы один день.", "BWarn")
            return

        slots = build_slots_from_schedule(schedule, len(files))
        tags  = self._norm_tags(self.batch_tags.text())

        lines = []
        for i, f in enumerate(files):
            if i < len(slots):
                dt_str = slots[i].strftime("%Y-%m-%d %H:%M")
                cap    = f.stem
                parts  = [str(f), tags, dt_str, cap]
                while parts and not parts[-1]: parts.pop()
                lines.append(" | ".join(parts))
            else:
                lines.append(f"# {f.name}  — слот не найден (расширь расписание)")

        self._batch_strings = lines
        self.batch_preview.setPlainText("\n".join(lines))
        self._rebuild_cards(lines)

        covered = min(len(slots), len(files))
        missing = len(files) - covered
        if missing > 0:
            self._set_warn(
                f"⚠ Расписание покрывает только {covered} из {len(files)} видео. "
                f"Добавь больше дней/слотов.", "BWarn")
        else:
            self._set_warn(f"✓ Все {len(files)} видео распределены по расписанию.", "BOk")

    def _set_warn(self, text, obj):
        self.batch_warn.setText(text); self.batch_warn.setObjectName(obj)
        self.batch_warn.style().unpolish(self.batch_warn)
        self.batch_warn.style().polish(self.batch_warn)

    def _copy_batch(self):
        if not self._batch_strings: self._generate_batch()
        if not self._batch_strings: return
        QGuiApplication.clipboard().setText("\n".join(self._batch_strings))
        self.status.showMessage(f"Скопировано {len(self._batch_strings)} строк.", 3000)

    # ── single builder ────────────────────────────────────────────────────
    def _short(self, s, n=64): return s if len(s)<=n else s[:n-1]+"…"
    def _norm_tags(self, raw):
        out = []
        for t in raw.replace(","," ").split():
            t = t.strip()
            if t and not t.startswith("#"): t = "#"+t
            if t: out.append(t)
        return " ".join(out)

    def _browse_file(self):
        filt = "Видео ("+" ".join("*"+e for e in sorted(VIDEO_EXTS))+")"
        start = str(Path(self.path_edit.text()).parent) if self.path_edit.text() else str(Path.home())
        p,_ = QFileDialog.getOpenFileName(self,"Видеофайл",start,filt)
        if p: self.path_edit.setText(p)

    def build_string(self):
        path = self.path_edit.text().strip(); tags = self._norm_tags(self.tags_edit.text())
        caption = self.caption_edit.toPlainText().strip().replace("|","")
        date = self.date_edit.dateTime().toString("yyyy-MM-dd HH:mm") \
               if self.date_check.isChecked() else ""
        parts = [path,tags,date,caption]
        while parts and not parts[-1]: parts.pop()
        result = " | ".join(parts); self.preview.setPlainText(result); return result

    def copy_string(self):
        text = self.build_string()
        if not self.path_edit.text().strip():
            QMessageBox.warning(self,"Нет пути","Укажи путь к видеофайлу."); return
        QGuiApplication.clipboard().setText(text)
        self._push_history(text); self._save_state()
        self.status.showMessage("Скопировано.", 3000)

    def clear_all(self):
        self.path_edit.clear(); self.tags_edit.clear(); self.caption_edit.clear()
        self.date_check.setChecked(False)
        self.date_edit.setDateTime(QDateTime.currentDateTime().addSecs(3600))
        self.preview.clear(); self.status.showMessage("Очищено.", 2000)

    def on_history(self, idx):
        if idx<=0: return
        raw = self.history_combo.itemData(idx) or ""
        if not raw: return
        parts = [p.strip() for p in raw.split("|")]
        while len(parts)<4: parts.append("")
        self.path_edit.setText(parts[0]); self.tags_edit.setText(parts[1])
        if parts[2]:
            self.date_check.setChecked(True)
            dt = QDateTime.fromString(parts[2],"yyyy-MM-dd HH:mm")
            if dt.isValid(): self.date_edit.setDateTime(dt)
        else: self.date_check.setChecked(False)
        self.caption_edit.setPlainText(parts[3])
        self.history_combo.setCurrentIndex(0); self.build_string()

    def ping_bridge(self):
        self.bridge_label.setText("Bridge…"); self.bridge_label.setObjectName("BridgeWait")
        self.bridge_label.style().unpolish(self.bridge_label)
        self.bridge_label.style().polish(self.bridge_label)
        t = BridgePing(); t.result.connect(self._on_ping); self.ping_thread=t; t.start()

    def _on_ping(self, ok, msg):
        self.bridge_label.setText("Bridge: OK" if ok else "Bridge: ✗")
        self.bridge_label.setObjectName("BridgeOk" if ok else "BridgeErr")
        self.bridge_label.style().unpolish(self.bridge_label)
        self.bridge_label.style().polish(self.bridge_label)
        if not ok: self.status.showMessage(f"Bridge: {msg}", 4000)

    def _push_history(self, line):
        hist = list(self.cfg.get("history",[]))
        if line in hist: hist.remove(line)
        hist.insert(0,line); hist=hist[:HISTORY_LIMIT]; self.cfg["history"]=hist
        self.history_combo.blockSignals(True); self.history_combo.clear()
        self.history_combo.addItem("— выбери прошлую строку —","")
        for s in hist: self.history_combo.addItem(self._short(s),s)
        self.history_combo.blockSignals(False)

    def _get_schedule_data(self):
        return {r.day_key: r.get_data() for r in self.day_rows}

    def save_schedule(self):
        self.cfg["schedule"] = self._get_schedule_data(); self._save_state()
        self.status.showMessage("Расписание сохранено.", 3000)

    def reset_schedule(self):
        for r in self.day_rows: r.chk.setChecked(False); r.spin.setValue(0)
        self.status.showMessage("Расписание сброшено.", 2000)

    def copy_schedule_text(self):
        data = self._get_schedule_data(); lines = []
        for key,ru in zip(DAYS_EN,DAYS_RU):
            d = data.get(key,{})
            if not d.get("enabled"): continue
            times = d.get("times",[]); count = d.get("count",0)
            lines.append(f"{ru}: {count} ролик(а)  →  {', '.join(times[:count]) or '—'}")
        if not lines: self.status.showMessage("Нет активных дней.",2000); return
        QGuiApplication.clipboard().setText("\n".join(lines))
        self.status.showMessage("Расписание скопировано.", 3000)

    def _save_state(self):
        self.cfg.update({
            "last_path":    self.path_edit.text().strip(),
            "last_tags":    self.tags_edit.text().strip(),
            "last_caption": self.caption_edit.toPlainText().strip(),
            "schedule":     self._get_schedule_data(),
        })
        save_config(self.cfg)

    def closeEvent(self, e): self._save_state(); super().closeEvent(e)


def main():
    app = QApplication(sys.argv); app.setStyleSheet(QSS)
    app.setApplicationName("TT String Builder"); app.setWindowIcon(make_icon())
    win = StringBuilder(); win.show(); return app.exec()

if __name__ == "__main__": sys.exit(main())
