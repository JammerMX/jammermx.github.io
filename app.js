// =====================================================================
// КОНФИГУРАЦИЯ ПОДКЛЮЧЕНИЯ К БЭКЕНДУ
// На этапе разработки укажите URL вашего туннеля (ngrok / cloudflared),
// а после деплоя — домен вашего сервера.
// =====================================================================
const API_BASE_URL = "https://prayers-boats-receptor-ultra.trycloudflare.com";

const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// Универсальная функция запроса к API с передачей Telegram initData
async function apiRequest(endpoint, payload = {}) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": tg.initData || "",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Ошибка запроса к серверу");
  }
  return data;
}

// Перевод статусов подарка на понятный русский язык
const STATUS_LABELS = {
  waiting_draw: "Ожидание жеребьевки ⏳",
  preparing: "Готовится Тайным Сантой 🎄",
  dropped_off: "Ждет вас в пункте выдачи! 📦",
  picked_up: "Подарок получен 🎉",
};

// =====================================================================
// СИНХРОНИЗАЦИЯ СОСТОЯНИЯ И ОТРИСОВКА UI
// =====================================================================
async function syncAppState() {
  try {
    const state = await apiRequest("/api/sync");
    const { user, game, recipient } = state;

    // 1. Заполняем профиль и статистику
    document.getElementById("user-name").textContent = user.first_name;
    if (user.photo_url) {
      document.getElementById("user-photo").src = user.photo_url;
    }
    document.getElementById("wishes-input").value = user.wishes || "";

    document.getElementById("stat-total").textContent = game.total_participants;
    document.getElementById("stat-total-sub").textContent = game.total_participants;
    document.getElementById("stat-wishes").textContent = game.wishes_completed;

    // 2. Заполняем вкладку Настройки
    document.getElementById("set-name").textContent = user.first_name;
    document.getElementById("set-id").textContent = user.tg_id;
    document.getElementById("set-role").textContent =
      user.role === "admin" ? "Организатор (Админ)" : user.role === "staff" ? "Персонал пункта" : "Участник";
    document.getElementById("set-gift-status").textContent =
      STATUS_LABELS[user.my_incoming_gift_status] || user.my_incoming_gift_status;

    // 3. Показываем плавающую кнопку QR-сканера справа от homebar ТОЛЬКО админу и персоналу
    const staffFab = document.getElementById("btn-staff-scanner");
    if (user.role === "admin" || user.role === "staff") {
      staffFab.classList.remove("hidden");
    } else {
      staffFab.classList.add("hidden");
    }

    // 4. Кнопка запуска жеребьевки для админа (пока жеребьевка еще не проведена)
    const btnDraw = document.getElementById("btn-admin-draw");
    if (user.role === "admin" && !game.draw_completed) {
      btnDraw.classList.remove("hidden");
    } else {
      btnDraw.classList.add("hidden");
    }

    // 5. Отображаем карточку подопечного и кнопки QR после жеребьевки
    const recSection = document.getElementById("recipient-section");
    const btnDropoff = document.getElementById("btn-dropoff-qr");
    const btnPickup = document.getElementById("btn-pickup-qr");

    if (game.draw_completed && recipient) {
      recSection.classList.remove("hidden");
      document.getElementById("rec-name").textContent = recipient.first_name;
      document.getElementById("rec-wishes").textContent = recipient.wishes;
      document.getElementById("rec-status").textContent =
        recipient.gift_status === "preparing" ? "Ждет сдачи в пункт" : "Сдан в пункт ✅";

      // Если мы еще не сдали подарок для нашего подопечного — показываем кнопку сдачи
      if (recipient.gift_status === "preparing") {
        btnDropoff.classList.remove("hidden");
      } else {
        btnDropoff.classList.add("hidden");
      }
    }

    // 6. Если подарок ДЛЯ НАС уже сдан нашим Тайным Сантой в пункт — показываем кнопку получения
    if (user.my_incoming_gift_status === "dropped_off") {
      btnPickup.classList.remove("hidden");
    } else {
      btnPickup.classList.add("hidden");
    }
  } catch (err) {
    tg.showAlert("Ошибка синхронизации: " + err.message);
  }
}

// =====================================================================
// СОХРАНЕНИЕ ПОЖЕЛАНИЙ
// =====================================================================
document.getElementById("btn-save-wishes").addEventListener("click", async () => {
  const wishes = document.getElementById("wishes-input").value;
  try {
    await apiRequest("/api/wishes", { wishes });
    tg.HapticFeedback.notificationOccurred("success");
    tg.showAlert("Ваше письмо Тайному Санте успешно сохранено! 🎅");
    await syncAppState();
  } catch (err) {
    tg.showAlert(err.message);
  }
});

// =====================================================================
// ГЕНЕРАЦИЯ ОДНОРАЗОВОГО QR-КОДА (СДАЧА И ВЫДАЧА ПОДАРКА)
// =====================================================================
async function openQrModal(action) {
  try {
    const res = await apiRequest("/api/qr", { action });
    const modal = document.getElementById("qr-modal");
    const qrBox = document.getElementById("qrcode-box");
    qrBox.innerHTML = "";

    document.getElementById("qr-modal-title").textContent =
      action === "dropoff" ? "QR для сдачи подарка 📦" : "QR для получения подарка 🎁";

    // Отрисовываем QR-код
    new QRCode(qrBox, {
      text: res.token,
      width: 200,
      height: 200,
      colorDark: "#1E1E1E",
      colorLight: "#FFFFFF",
    });

    // Выводим 8-значный резервный код под QR-кодом
    document.getElementById("qr-backup-code").textContent = res.backup_code;
    document.getElementById("qr-cooldown-note").textContent = res.message;

    modal.classList.remove("hidden");
  } catch (err) {
    tg.showAlert(err.message);
  }
}

document.getElementById("btn-dropoff-qr").addEventListener("click", () => openQrModal("dropoff"));
document.getElementById("btn-pickup-qr").addEventListener("click", () => openQrModal("pickup"));
document.getElementById("btn-close-qr").addEventListener("click", () => {
  document.getElementById("qr-modal").classList.add("hidden");
  syncAppState();
});

// =====================================================================
// СКАНЕР QR И РУЧНОЙ ВВОД ДЛЯ ПЕРСОНАЛА ПУНКТА ВЫДАЧИ
// =====================================================================
const staffModal = document.getElementById("staff-modal");

document.getElementById("btn-staff-scanner").addEventListener("click", () => {
  document.getElementById("staff-result-box").classList.add("hidden");
  document.getElementById("staff-manual-code").value = "";
  staffModal.classList.remove("hidden");
});

document.getElementById("btn-close-staff").addEventListener("click", () => {
  staffModal.classList.add("hidden");
  syncAppState();
});

async function processStaffCode(codeString) {
  try {
    const res = await apiRequest("/api/staff/scan", { code: codeString });
    tg.HapticFeedback.notificationOccurred("success");

    const resultBox = document.getElementById("staff-result-box");
    document.getElementById("staff-box-number").textContent = `#${res.box_number}`;
    document.getElementById("staff-instruction").textContent = res.instruction;
    resultBox.classList.remove("hidden");
  } catch (err) {
    tg.HapticFeedback.notificationOccurred("error");
    tg.showAlert(err.message);
  }
}

// Нативный сканер QR от Telegram Mini App
document.getElementById("btn-open-native-scanner").addEventListener("click", () => {
  tg.showScanQrPopup({ text: "Наведите камеру на QR-код участника" }, (scannedText) => {
    if (scannedText) {
      tg.closeScanQrPopup();
      processStaffCode(scannedText);
      return true;
    }
  });
});

// Ручной ввод резервного кода (если камера не смогла считать QR)
document.getElementById("btn-submit-manual-code").addEventListener("click", () => {
  const manualCode = document.getElementById("staff-manual-code").value.trim();
  if (!manualCode) return;
  processStaffCode(manualCode);
});

// =====================================================================
// ЗАПУСК ЖЕРЕБЬЕВКИ АДМИНОМ И ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК HOMEBAR
// =====================================================================
document.getElementById("btn-admin-draw").addEventListener("click", () => {
  tg.showConfirm("Запустить жеребьевку Тайного Санты сейчас?", async (confirmed) => {
    if (!confirmed) return;
    try {
      const res = await apiRequest("/api/admin/draw");
      tg.showAlert(res.message);
      await syncAppState();
    } catch (err) {
      tg.showAlert(err.message);
    }
  });
});

// Навигация по нижнему Homebar
document.querySelectorAll(".nav-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-view").forEach((v) => v.classList.remove("active"));

    btn.classList.add("active");
    document.getElementById(btn.dataset.target).classList.add("active");
  });
});

document.getElementById("btn-top-settings").addEventListener("click", () => {
  document.querySelector('[data-target="tab-settings"]').click();
});

document.getElementById("btn-close").addEventListener("click", () => tg.close());

document.getElementById("btn-share").addEventListener("click", () => {
  const shareText = encodeURIComponent("Присоединяйся к нашей игре в Тайного Санту 2026! 🎅🎁");
  tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${shareText}`);
});

// Первичная загрузка данных при открытии приложения
syncAppState();