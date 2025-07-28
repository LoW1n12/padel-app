// webapp/script.js (финальная версия с обходом защиты localtunnel)

// Вставьте сюда свой URL, который выдал localtunnel
const API_BASE_URL = "https://tidy-snails-think.loca.lt";

document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();

    // ... (Экраны и Элементы UI без изменений) ...
    const locationScreen = document.getElementById('location-screen');
    const sessionsScreen = document.getElementById('sessions-screen');
    const locationList = document.getElementById('location-list');
    const sessionsList = document.getElementById('sessions-list');
    const sessionsHeader = document.getElementById('sessions-header');
    const backToLocationsBtn = document.getElementById('back-to-locations');
    const currentDateEl = document.getElementById('current-date');
    const prevDayBtn = document.getElementById('prev-day');
    const nextDayBtn = document.getElementById('next-day');
    const addNotificationBtn = document.getElementById('add-notification-btn');

    let currentDate = new Date();
    let selectedLocation = null;

    function showScreen(screen) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        screen.classList.add('active');
    }

    // --- ИЗМЕНЕНО: Добавлен заголовок для обхода защиты ---
    async function fetchAPI(path) {
        const response = await fetch(`${API_BASE_URL}${path}`, {
            headers: {
                // Этот заголовок говорит localtunnel пропустить страницу с паролем
                'Bypass-Tunnel-Reminder': 'true'
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async function fetchLocations() {
        try {
            const data = await fetchAPI('/api/locations');
            renderLocations(data.locations);
        } catch (error) {
            console.error('Ошибка загрузки локаций:', error);
            locationList.innerHTML = '<div class="list-item">Не удалось загрузить локации. Убедитесь, что бот и localtunnel запущены.</div>';
        }
    }

    async function fetchSessions() {
        if (!selectedLocation) return;
        const dateString = currentDate.toISOString().split('T')[0];
        sessionsList.innerHTML = '<div class="skeleton-item"></div><div class="skeleton-item"></div>';

        try {
            const data = await fetchAPI(`/api/sessions?location=${encodeURIComponent(selectedLocation)}&date=${dateString}`);
            renderSessions(data);
        } catch (error) {
            console.error('Ошибка загрузки сеансов:', error);
            sessionsList.innerHTML = '<div class="list-item">Не удалось загрузить сеансы</div>';
        }
    }

    function renderLocations(locations) {
        locationList.innerHTML = '';
        locations.forEach(loc => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `<span class="list-item-title">${loc.name}</span><span class="chevron">&gt;</span>`;
            item.addEventListener('click', () => {
                selectedLocation = loc.id;
                sessionsHeader.textContent = loc.name;
                updateCurrentDate();
                fetchSessions();
                showScreen(sessionsScreen);
            });
            locationList.appendChild(item);
        });
    }

    function renderSessions(data) {
        sessionsList.innerHTML = '';
        if (Object.keys(data).length === 0) {
            sessionsList.innerHTML = '<div class="list-item">На эту дату свободных сеансов нет</div>';
            return;
        }
        for (const time in data) {
            const courtData = data[time];
            let details = Object.entries(courtData).map(([type, info]) => `${type} - ${info.price} ₽`).join(' | ');
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `<div class="list-item-title">${time}</div><div class="list-item-subtitle">${details}</div>`;
            sessionsList.appendChild(item);
        }
    }

    function updateCurrentDate() {
        currentDateEl.textContent = currentDate.toLocaleDateString('ru-RU', {
            weekday: 'short', day: 'numeric', month: 'long'
        });
    }

    backToLocationsBtn.addEventListener('click', () => {
        showScreen(locationScreen);
    });

    prevDayBtn.addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() - 1);
        updateCurrentDate();
        fetchSessions();
    });

    nextDayBtn.addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() + 1);
        updateCurrentDate();
        fetchSessions();
    });

    addNotificationBtn.addEventListener('click', () => {
        tg.MainButton.setText(`Уведомить о сеансах`);
        tg.MainButton.show();
        tg.MainButton.onClick(async () => {
            const subscription = {
                location: selectedLocation,
                hour: -1,
                court_types: ["Корт для 4-х", "Корт для 2-х", "Открытый корт", "Закрытый корт", "Корт (тип 1)", "Корт (тип 2)", "Ultra корт", "Корт"],
                monitor_data: { type: "specific", value: currentDate.toISOString().split('T')[0] }
            };

            try {
                 // --- ИЗМЕНЕНО: Добавлен заголовок и в этот запрос ---
                await fetch(`${API_BASE_URL}/api/subscribe`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Bypass-Tunnel-Reminder': 'true'
                    },
                    body: JSON.stringify({
                        initData: tg.initData,
                        subscription: subscription
                    })
                });
                tg.close();
            } catch (error) {
                console.error('Ошибка подписки:', error);
                tg.showAlert('Не удалось добавить уведомление.');
            }
        });
    });

    fetchLocations();
});
