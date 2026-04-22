#!/usr/bin/env python3
"""
TikTok String Builder (PySide6)
-------------------------------------------------
Десктоп-приложение для быстрой сборки строки, которую потом
нужно вставить в панель «TT Helper LIGHT» в TikTok Studio.

Возможности:
  * выбор видеофайла через диалог
  * нормализация хештегов
  * опциональная дата публикации
  * история последних 10 строк
  * проверка связи с локальным bridge
  * сохранение последнего состояния между запусками

Формат итоговой строки:
    <path> | <tags> | <date> | <caption>
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import List

from PySide6.QtCore import Qt, QDateTime, QSize, QThread, Signal
from PySide6.QtGui import QAction, QGuiApplication, QIcon, QKeySequence, QPixmap, QPainter, QColor
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QDateTimeEdit,
    QFileDialog,
    QFormLayout,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QStatusBar,
    QVBoxLayout,
    QWidget,
)


# ---------------------------------------------------------------------------
# constants
# ---------------------------------------------------------------------------
BRIDGE_URL = "http://127.0.0.1:8765"
BRIDGE_TOKEN = "1224444"
HISTORY_LIMIT = 10

CONFIG_DIR = Path.home() / ".tiktok_bridge"
CONFIG_FILE = CONFIG_DIR / "string_builder.json"

VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".mpg", ".mpeg"}


DARK_QSS = """
QWidget {
    background-color: #18181b;
    color: #e5e7eb;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
}
QFrame#Card {
    background-color: #09090b;
    border: 1px solid #3f3f46;
    border-radius: 10px;
}
QLabel#Title {
    color: #ffffff;
    font-size: 18px;
    font-weight: 700;
}
QLabel#Subtitle {
    color: #a1a1aa;
    font-size: 12px;
}
QLabel[role="field"] {
    color: #d4d4d8;
    font-weight: 600;
}
QLineEdit, QPlainTextEdit, QDateTimeEdit, QComboBox {
    background-color: #09090b;
    border: 1px solid #3f3f46;
    border-radius: 8px;
    padding: 6px 8px;
    color: #e5e7eb;
    selection-background-color: #4f46e5;
}
QLineEdit:focus, QPlainTextEdit:focus, QDateTimeEdit:focus, QComboBox:focus {
    border: 1px solid #6366f1;
}
QComboBox::drop-down { border: none; width: 18px; }
QComboBox QAbstractItemView {
    background: #09090b; color: #e5e7eb;
    selection-background-color: #4f46e5;
    border: 1px solid #3f3f46;
}
QPushButton {
    background-color: #27272a;
    color: #e5e7eb;
    border: none;
    border-radius: 8px;
    padding: 8px 14px;
    font-weight: 600;
}
QPushButton:hover { background-color: #3f3f46; }
QPushButton:pressed { background-color: #52525b; }
QPushButton#Primary { background-color: #4f46e5; color: #ffffff; }
QPushButton#Primary:hover { background-color: #4338ca; }
QPushButton#Primary:pressed { background-color: #3730a3; }
QCheckBox { color: #d4d4d8; }
QStatusBar { background: #09090b; color: #a1a1aa; }
QLabel#BridgeOk { color: #86efac; font-weight: 600; }
QLabel#BridgeErr { color: #fca5a5; font-weight: 600; }
QLabel#BridgeWait { color: #bfdbfe; font-weight: 600; }
"""


# ---------------------------------------------------------------------------
# config
# ---------------------------------------------------------------------------
def load_config() -> dict:
    try:
        if CONFIG_FILE.is_file():
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {"last_path": "", "last_tags": "", "history": []}


def save_config(cfg: dict) -> None:
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# bridge check (background)
# ---------------------------------------------------------------------------
class BridgePing(QThread):
    result = Signal(bool, str)

    def run(self) -> None:
        try:
            with urllib.request.urlopen(BRIDGE_URL + "/health", timeout=3) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    self.result.emit(True, data.get("bridge", "ok"))
                    return
                self.result.emit(False, f"HTTP {resp.status}")
        except Exception as e:
            self.result.emit(False, str(e))


# ---------------------------------------------------------------------------
# icon
# ---------------------------------------------------------------------------
def make_icon() -> QIcon:
    pm = QPixmap(64, 64)
    pm.fill(QColor("#4f46e5"))
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    p.setPen(QColor("#ffffff"))
    font = p.font()
    font.setPointSize(28)
    font.setBold(True)
    p.setFont(font)
    p.drawText(pm.rect(), Qt.AlignCenter, "TT")
    p.end()
    return QIcon(pm)


# ---------------------------------------------------------------------------
# main window
# ---------------------------------------------------------------------------
class StringBuilder(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.cfg = load_config()
        self.ping_thread: BridgePing | None = None

        self.setWindowTitle("TikTok String Builder")
        self.setWindowIcon(make_icon())
        self.resize(600, 640)
        self.setMinimumSize(520, 580)

        central = QWidget(self)
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(12)

        # ---------- Header ----------
        header_row = QHBoxLayout()
        title_box = QVBoxLayout()
        title_box.setSpacing(2)
        title = QLabel("TikTok String Builder")
        title.setObjectName("Title")
        subtitle = QLabel("Собери строку для панели TT Helper LIGHT и скопируй одной кнопкой.")
        subtitle.setObjectName("Subtitle")
        subtitle.setWordWrap(True)
        title_box.addWidget(title)
        title_box.addWidget(subtitle)
        header_row.addLayout(title_box, 1)

        self.bridge_label = QLabel("Bridge: …")
        self.bridge_label.setObjectName("BridgeWait")
        self.bridge_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        header_row.addWidget(self.bridge_label)
        root.addLayout(header_row)

        # ---------- Input card ----------
        card = QFrame()
        card.setObjectName("Card")
        form = QFormLayout(card)
        form.setContentsMargins(14, 14, 14, 14)
        form.setSpacing(10)
        form.setLabelAlignment(Qt.AlignLeft)

        # path + browse
        self.path_edit = QLineEdit()
        self.path_edit.setPlaceholderText(r"D:\Videos\cat.mp4")
        self.path_edit.setText(self.cfg.get("last_path", ""))
        browse_btn = QPushButton("Обзор…")
        browse_btn.clicked.connect(self.browse_file)
        path_wrap = QWidget()
        path_row = QHBoxLayout(path_wrap)
        path_row.setContentsMargins(0, 0, 0, 0)
        path_row.setSpacing(8)
        path_row.addWidget(self.path_edit, 1)
        path_row.addWidget(browse_btn)
        form.addRow(self._field_label("Путь к видео*"), path_wrap)

        # tags
        self.tags_edit = QLineEdit()
        self.tags_edit.setPlaceholderText("#cats #funny #pet")
        self.tags_edit.setText(self.cfg.get("last_tags", ""))
        form.addRow(self._field_label("Хештеги"), self.tags_edit)

        # date
        self.date_check = QCheckBox("Запланировать публикацию")
        self.date_check.stateChanged.connect(self.on_date_toggle)
        self.date_edit = QDateTimeEdit()
        self.date_edit.setDisplayFormat("yyyy-MM-dd HH:mm")
        self.date_edit.setCalendarPopup(True)
        self.date_edit.setDateTime(QDateTime.currentDateTime().addSecs(60 * 60))
        self.date_edit.setEnabled(False)

        date_wrap = QWidget()
        date_row = QHBoxLayout(date_wrap)
        date_row.setContentsMargins(0, 0, 0, 0)
        date_row.setSpacing(8)
        date_row.addWidget(self.date_check)
        date_row.addWidget(self.date_edit, 1)
        form.addRow(self._field_label("Дата / время"), date_wrap)

        # caption
        self.caption_edit = QPlainTextEdit()
        self.caption_edit.setPlaceholderText("Мой кот делает что-то смешное")
        self.caption_edit.setFixedHeight(70)
        form.addRow(self._field_label("Описание"), self.caption_edit)

        root.addWidget(card)

        # ---------- Preview ----------
        preview_card = QFrame()
        preview_card.setObjectName("Card")
        pv = QVBoxLayout(preview_card)
        pv.setContentsMargins(14, 14, 14, 14)
        pv.setSpacing(8)

        pv.addWidget(self._field_label("Готовая строка"))
        self.preview = QPlainTextEdit()
        self.preview.setReadOnly(True)
        self.preview.setFixedHeight(80)
        self.preview.setPlaceholderText("Здесь появится строка для вставки в панель TikTok Studio.")
        pv.addWidget(self.preview)

        root.addWidget(preview_card)

        # ---------- Actions ----------
        actions = QHBoxLayout()
        actions.setSpacing(8)
        build_btn = QPushButton("Собрать")
        build_btn.setToolTip("Ctrl+B")
        build_btn.clicked.connect(self.build_string)
        copy_btn = QPushButton("Скопировать")
        copy_btn.setObjectName("Primary")
        copy_btn.setToolTip("Ctrl+Enter")
        copy_btn.clicked.connect(self.copy_string)
        check_btn = QPushButton("Проверить bridge")
        check_btn.clicked.connect(self.ping_bridge)
        clear_btn = QPushButton("Очистить")
        clear_btn.clicked.connect(self.clear_all)
        actions.addWidget(build_btn)
        actions.addWidget(copy_btn)
        actions.addWidget(check_btn)
        actions.addWidget(clear_btn)
        actions.addStretch(1)
        root.addLayout(actions)

        # ---------- History ----------
        hist_card = QFrame()
        hist_card.setObjectName("Card")
        hist_layout = QHBoxLayout(hist_card)
        hist_layout.setContentsMargins(14, 10, 14, 10)
        hist_layout.setSpacing(8)
        hist_layout.addWidget(self._field_label("История"))
        self.history_combo = QComboBox()
        self.history_combo.addItem("— выбери прошлую строку —", "")
        for s in self.cfg.get("history", []):
            self.history_combo.addItem(self._shorten(s), s)
        self.history_combo.activated.connect(self.on_history_select)
        hist_layout.addWidget(self.history_combo, 1)
        root.addWidget(hist_card)

        # ---------- Status ----------
        self.status = QStatusBar()
        self.setStatusBar(self.status)
        self.status.showMessage("Готов к работе.")

        # ---------- Shortcuts ----------
        for key, fn in [
            ("Ctrl+B", self.build_string),
            ("Ctrl+Return", self.copy_string),
            ("Ctrl+O", self.browse_file),
        ]:
            act = QAction(self)
            act.setShortcut(QKeySequence(key))
            act.triggered.connect(fn)
            self.addAction(act)

        # live rebuild
        self.path_edit.textChanged.connect(self.build_string)
        self.tags_edit.textChanged.connect(self.build_string)
        self.caption_edit.textChanged.connect(self.build_string)
        self.date_edit.dateTimeChanged.connect(self.build_string)
        self.date_check.stateChanged.connect(self.build_string)

        # first ping
        self.ping_bridge()
        self.build_string()

    # ---------- helpers ----------
    @staticmethod
    def _field_label(text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setProperty("role", "field")
        return lbl

    @staticmethod
    def _shorten(s: str, n: int = 70) -> str:
        return s if len(s) <= n else s[: n - 1] + "…"

    # ---------- slots ----------
    def on_date_toggle(self, state: int) -> None:
        self.date_edit.setEnabled(bool(state))

    def browse_file(self) -> None:
        start_dir = ""
        current = self.path_edit.text().strip()
        if current and os.path.isfile(current):
            start_dir = os.path.dirname(current)
        file_path, _ = QFileDialog.getOpenFileName(
            self, "Выбери видеофайл", start_dir,
            "Видео (*.mp4 *.mov *.avi *.mkv *.webm *.m4v);;Все файлы (*)",
        )
        if file_path:
            self.path_edit.setText(file_path)

    def normalize_tags(self, raw: str) -> str:
        raw = (raw or "").strip()
        if not raw:
            return ""
        parts = [p.strip() for p in raw.replace(",", " ").split() if p.strip()]
        fixed: List[str] = []
        seen = set()
        for p in parts:
            if not p.startswith("#"):
                p = "#" + p.lstrip("#")
            key = p.lower()
            if key in seen:
                continue
            seen.add(key)
            fixed.append(p)
        return " ".join(fixed)

    def build_string(self) -> str:
        path = self.path_edit.text().strip().replace("|", "/")
        tags = self.normalize_tags(self.tags_edit.text()).replace("|", " ")
        date = ""
        if self.date_check.isChecked():
            date = self.date_edit.dateTime().toString("yyyy-MM-dd HH:mm")
        caption = self.caption_edit.toPlainText().strip().replace("\n", " ").replace("|", "/")

        # валидация пути — подсветим в статусе
        if path:
            ext = os.path.splitext(path)[1].lower()
            if not os.path.isfile(path):
                self.status.showMessage(f"Файл не найден: {path}", 3000)
            elif ext and ext not in VIDEO_EXTS:
                self.status.showMessage(f"Предупреждение: расширение {ext!r} не похоже на видео.", 3000)

        parts = [path, tags, date, caption]
        while parts and parts[-1] == "":
            parts.pop()
        result = " | ".join(parts)
        self.preview.setPlainText(result)
        return result

    def copy_string(self) -> None:
        text = self.build_string()
        if not self.path_edit.text().strip():
            QMessageBox.warning(self, "Нет пути", "Поле «Путь к видео» обязательное.")
            return
        if not text:
            QMessageBox.warning(self, "Пусто", "Сначала заполни поля.")
            return
        QGuiApplication.clipboard().setText(text)
        self._push_history(text)
        self._save_state()
        self.status.showMessage("Строка скопирована в буфер обмена.", 4000)

    def clear_all(self) -> None:
        self.path_edit.clear()
        self.tags_edit.clear()
        self.caption_edit.clear()
        self.date_check.setChecked(False)
        self.date_edit.setDateTime(QDateTime.currentDateTime().addSecs(60 * 60))
        self.preview.clear()
        self.status.showMessage("Очищено.", 2000)

    def on_history_select(self, index: int) -> None:
        if index <= 0:
            return
        raw = self.history_combo.itemData(index) or ""
        if not raw:
            return
        parts = [p.strip() for p in raw.split("|")]
        while len(parts) < 4:
            parts.append("")
        self.path_edit.setText(parts[0])
        self.tags_edit.setText(parts[1])
        if parts[2]:
            self.date_check.setChecked(True)
            dt = QDateTime.fromString(parts[2], "yyyy-MM-dd HH:mm")
            if dt.isValid():
                self.date_edit.setDateTime(dt)
        else:
            self.date_check.setChecked(False)
        self.caption_edit.setPlainText(parts[3])
        self.history_combo.setCurrentIndex(0)

    def ping_bridge(self) -> None:
        self.bridge_label.setText("Bridge: проверяю…")
        self.bridge_label.setObjectName("BridgeWait")
        self.bridge_label.style().unpolish(self.bridge_label)
        self.bridge_label.style().polish(self.bridge_label)
        self.ping_thread = BridgePing()
        self.ping_thread.result.connect(self._on_ping)
        self.ping_thread.start()

    def _on_ping(self, ok: bool, msg: str) -> None:
        if ok:
            self.bridge_label.setText("Bridge: OK")
            self.bridge_label.setObjectName("BridgeOk")
        else:
            self.bridge_label.setText("Bridge: недоступен")
            self.bridge_label.setObjectName("BridgeErr")
            self.status.showMessage(f"Bridge: {msg}", 4000)
        self.bridge_label.style().unpolish(self.bridge_label)
        self.bridge_label.style().polish(self.bridge_label)

    # ---------- persistence ----------
    def _push_history(self, line: str) -> None:
        hist: List[str] = list(self.cfg.get("history", []))
        if line in hist:
            hist.remove(line)
        hist.insert(0, line)
        hist = hist[:HISTORY_LIMIT]
        self.cfg["history"] = hist
        # refresh combo
        self.history_combo.blockSignals(True)
        self.history_combo.clear()
        self.history_combo.addItem("— выбери прошлую строку —", "")
        for s in hist:
            self.history_combo.addItem(self._shorten(s), s)
        self.history_combo.blockSignals(False)

    def _save_state(self) -> None:
        self.cfg["last_path"] = self.path_edit.text().strip()
        self.cfg["last_tags"] = self.tags_edit.text().strip()
        save_config(self.cfg)

    def closeEvent(self, event) -> None:
        self._save_state()
        super().closeEvent(event)


# ---------------------------------------------------------------------------
def main() -> int:
    app = QApplication(sys.argv)
    app.setStyleSheet(DARK_QSS)
    app.setApplicationName("TikTok String Builder")
    app.setWindowIcon(make_icon())
    win = StringBuilder()
    win.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
