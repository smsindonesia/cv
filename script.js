// 1. Inisialisasi Supabase - Pastikan ini hanya dipanggil SEKALI
const SUPABASE_URL = 'https://gplpdoogcmbtltxrmoet.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwbHBkb29nY21idGx0eHJtb2V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0ODk3NjgsImV4cCI6MjA4NDA2NTc2OH0.7Ved9k_EqbmRu-t2cO1-vNJHh7GOb2jnBfZQjp2fwWU';

// Cek apakah library supabase sudah dimuat
if (typeof supabase === 'undefined') {
    console.error("Library Supabase tidak terdeteksi. Pastikan koneksi internet stabil atau matikan Tracking Prevention.");
}

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// State Management
let rekruters = [];
let treatments = [];
let selectedRekruterId = null;
let selectedVolunteerId = null;
let editingRekruterId = null;
let editingVolunteerId = null;
let isEditingBiodata = false;

// 🆕 FITUR 1: SIMPAN CURRENT PAGE KE LOCALSTORAGE
function saveCurrentPage(page, extraData = {}) {
    const pageState = {
        page: page,
        selectedRekruterId: selectedRekruterId,
        selectedVolunteerId: selectedVolunteerId,
        ...extraData
    };
    localStorage.setItem('currentPage', JSON.stringify(pageState));
}

function restoreCurrentPage() {
    const saved = localStorage.getItem('currentPage');
    if (saved) {
        try {
            const pageState = JSON.parse(saved);
            selectedRekruterId = pageState.selectedRekruterId;
            selectedVolunteerId = pageState.selectedVolunteerId;
            
            // Restore halaman yang sesuai
            if (pageState.page === 'volunteerDetail' && selectedRekruterId && selectedVolunteerId) {
                // Tampilkan detail volunteer
                document.getElementById('petaPage').style.display = 'none';
                document.getElementById('volunteerListPage').style.display = 'none';
                document.getElementById('volunteerDetailPage').style.display = 'block';
                renderVolunteerDetail();
            } else if (pageState.page === 'volunteerList' && selectedRekruterId) {
                // Tampilkan list volunteer
                const rekruter = rekruters.find(r => r.id === selectedRekruterId);
                if (rekruter) {
                    document.getElementById('volunteerListTitle').textContent = `Volunteer - ${rekruter.namaRekruter}`;
                    document.getElementById('petaPage').style.display = 'none';
                    document.getElementById('volunteerListPage').style.display = 'block';
                    renderVolunteerTable();
                }
            } else {
                // Tampilkan halaman biasa
                navigateTo(pageState.page || 'home');
            }
        } catch (e) {
            console.error('Gagal restore page:', e);
            navigateTo('home');
        }
    }
}

// 2. Pemantau Status Login (Auth Listener)
sb.auth.onAuthStateChange((event, session) => {
    const loginPage = document.getElementById('loginPage');
    const mainApp = document.getElementById('mainApp');

    if (session) {
        loginPage.style.display = 'none';
        mainApp.style.display = 'block';
        loadData().then(() => {
            // 🆕 Restore halaman setelah data dimuat
            restoreCurrentPage();
        });
        setupRealtime(); 
    } else {
        loginPage.style.display = 'flex';
        mainApp.style.display = 'none';
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
});

// 3. Gabungan Event Listeners
function setupEventListeners() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    // Auto-save Notes
    ['notesGoals', 'notesOutput', 'notesOutcome'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', debounce(() => saveVolunteerNotes(), 500));
        }
    });
}

// 4. Fungsi Login & Logout
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    // Memberi feedback loading pada tombol
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerText;
    submitBtn.innerText = "Memproses...";
    submitBtn.disabled = true;

    const { data, error } = await sb.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        const errorEl = document.getElementById('loginError');
        errorEl.textContent = 'Gagal Login: ' + error.message;
        errorEl.style.display = 'block';
        submitBtn.innerText = originalText;
        submitBtn.disabled = false;
    }
}

async function handleLogout() {
    // 1. Hapus state halaman yang tersimpan agar tidak balik ke home saat login lagi
    localStorage.removeItem('currentPage');
    
    // 2. Hapus sesi Supabase secara paksa dari browser storage
    // Ini penting karena Tracking Prevention sering menghalangi fungsi signOut standar
    for (let key in localStorage) {
        if (key.includes('sb-')) {
            localStorage.removeItem(key);
        }
    }

    try {
        // 3. Beritahu server Supabase untuk logout
        await sb.auth.signOut();
    } catch (error) {
        console.warn("Gagal kontak server, tapi sesi lokal sudah dihapus.");
    }

    // 4. Paksa pindah ke halaman login dan refresh total
    window.location.href = window.location.origin + window.location.pathname;
}

// 5. Database Operations (Load & Save)
async function loadData() {
    const { data, error } = await sb.from('volunteers').select('*').order('created_at', { ascending: true });
    if (error) {
        console.error('Gagal muat data dari database:', error);
    } else {
        rekruters = data.map(item => ({
            id: item.id,
            noTim: item.no_tim,
            namaRekruter: item.name,
            volunteers: item.volunteers_data || []
        }));
        renderRekruterTable();
        renderSummary();
        showLastUpdate();
    }
}

async function saveData() {
    console.log("Mencoba menyimpan data ke Supabase...", rekruters);
    for (const r of rekruters) {
        const { error } = await sb.from('volunteers').upsert({
            id: r.id,
            name: r.namaRekruter,
            no_tim: r.noTim,
            volunteers_data: r.volunteers,
            updated_at: new Date()
        });
        
        if (error) {
            console.error("Gagal Simpan:", error.message);
        } else {
            console.log("Data Berhasil Tersimpan di Cloud!");
        }
    }
}

// Navigation
function navigateTo(page) {
    const pages = ['homePage', 'petaPage', 'volunteerListPage', 'volunteerDetailPage', 'summaryPage', 'treatmentPage'];
    pages.forEach(p => {
        document.getElementById(p).style.display = 'none';
    });
    
    if (page === 'home') {
        document.getElementById('homePage').style.display = 'block';
        selectedRekruterId = null;
        selectedVolunteerId = null;
        saveCurrentPage('home'); // 🆕 Simpan state
    } else if (page === 'peta') {
        document.getElementById('petaPage').style.display = 'block';
        renderRekruterTable();
        saveCurrentPage('peta'); // 🆕 Simpan state
    } else if (page === 'summary') {
        document.getElementById('summaryPage').style.display = 'block';
        renderSummary();
        saveCurrentPage('summary'); // 🆕 Simpan state
    }
    if (page === 'treatment') {
        document.getElementById('treatmentPage').style.display = 'block';
        loadTreatments();
        renderTreatmentStats();
        saveCurrentPage('treatment'); // 🆕 Simpan state
    }
}

// Rekruter Functions
function showAddRekruter() {
    document.getElementById('addRekruterAlert').style.display = 'block';
}

function hideAddRekruter() {
    document.getElementById('addRekruterAlert').style.display = 'none';
}

function addRekruter() {
    const newRekruter = {
        id: Date.now(),
        noTim: '',
        namaRekruter: '',
        volunteers: []
    };
    rekruters.push(newRekruter);
    editingRekruterId = newRekruter.id;
    saveData();
    renderRekruterTable();
    hideAddRekruter();
}

function editRekruter(id) {
    editingRekruterId = id;
    renderRekruterTable();
}

function saveRekruter(id) {
    editingRekruterId = null;
    renderRekruterTable();
    saveData();
    showLastUpdate();
}

function updateRekruterField(id, field, value) {
    const rekruter = rekruters.find(r => r.id === id);
    if (rekruter) {
        rekruter[field] = value;
    }
}

async function deleteRekruter(id) {
    if (confirm('Hapus rekruter ini secara permanen dari database?')) {
        // 1. Hapus dari Database Supabase
        const { error } = await sb
            .from('volunteers')
            .delete()
            .eq('id', id);

        if (error) {
            alert("Gagal menghapus di cloud: " + error.message);
            console.error(error);
        } else {
            // 2. Jika sukses di cloud, hapus dari tampilan (array lokal)
            rekruters = rekruters.filter(r => r.id !== id);
            renderRekruterTable();
            renderSummary();
            showLastUpdate(); // Update jam terakhir update
            alert("Data berhasil dihapus permanen.");
        }
    }
}

function viewVolunteers(id) {
    selectedRekruterId = id;
    const rekruter = rekruters.find(r => r.id === id);
    document.getElementById('volunteerListTitle').textContent = `Volunteer - ${rekruter.namaRekruter}`;
    document.getElementById('petaPage').style.display = 'none';
    document.getElementById('volunteerListPage').style.display = 'block';
    renderVolunteerTable();
    saveCurrentPage('volunteerList'); // 🆕 Simpan state
}

function backToRekruterList() {
    selectedRekruterId = null;
    document.getElementById('volunteerListPage').style.display = 'none';
    document.getElementById('petaPage').style.display = 'block';
    saveCurrentPage('peta'); // 🆕 Simpan state
}

function renderRekruterTable() {
    const tbody = document.getElementById('rekruterTableBody');
    tbody.innerHTML = '';
    
    rekruters.forEach((rekruter, index) => {
        const tr = document.createElement('tr');
        
        if (editingRekruterId === rekruter.id) {
            tr.innerHTML = `
                <td>${index + 1}</td>
    <td>
        <input type="text" value="${rekruter.noTim}" 
    class="table-input"
    oninput="updateRekruterField(${rekruter.id}, 'noTim', this.value)"> 

<input type="text" value="${rekruter.namaRekruter}" 
    class="table-input"
    oninput="updateRekruterField(${rekruter.id}, 'namaRekruter', this.value)">
    </td>
                <td style="text-align: center;">${rekruter.volunteers.length}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon save" onclick="saveRekruter(${rekruter.id})">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </button>
                        <button class="btn-icon delete" onclick="deleteRekruter(${rekruter.id})">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </td>
            `;
        } else {
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>${rekruter.noTim || '-'}</td>
                <td>
                    <button class="btn-link" onclick="viewVolunteers(${rekruter.id})">
                        ${rekruter.namaRekruter || 'Belum diisi'}
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </button>
                </td>
                <td style="text-align: center;">${rekruter.volunteers.length}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon edit" onclick="editRekruter(${rekruter.id})">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="btn-icon delete" onclick="deleteRekruter(${rekruter.id})">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </td>
            `;
        }
        
        tbody.appendChild(tr);
    });
}

// Volunteer Functions
function showAddVolunteer() {
    document.getElementById('addVolunteerAlert').style.display = 'block';
}

function hideAddVolunteer() {
    document.getElementById('addVolunteerAlert').style.display = 'none';
}

function addVolunteer() {
    const rekruter = rekruters.find(r => r.id === selectedRekruterId);
    if (!rekruter) return;
    
    const newVolunteer = {
        id: Date.now(),
        nama: '',
        status: 'T1',
        biodata: {
            namaLengkap: '',
            nik: '',
            tempatLahir: '',
            tanggalLahir: '',
            jenisKelamin: '',
            agama: '',
            pendidikan: '',
            pekerjaan: '',
            alamat: '',
            kota: '',
            provinsi: '',
            noTelepon: '',
            email: '',
            statusPerkawinan: '',
            keterampilan: ''
        },
        tahapan: {
            T1: null, T2: null, T3: null, T4: null,
            T5: null, T6: null, T7: null, T8: null
        },
        notes: {
            goals: '',
            output: '',
            outcome: ''
        }
    };
    
    rekruter.volunteers.push(newVolunteer);
    editingVolunteerId = newVolunteer.id;
    saveData();
    renderVolunteerTable();
    hideAddVolunteer();
}

function editVolunteer(id) {
    editingVolunteerId = id;
    renderVolunteerTable();
}

function saveVolunteerEdit(id) {
    editingVolunteerId = null;
    saveData();
    renderVolunteerTable();
}

function updateVolunteerField(id, field, value) {
    const rekruter = rekruters.find(r => r.id === selectedRekruterId);
    const volunteer = rekruter.volunteers.find(v => v.id === id);
    if (volunteer) {
        volunteer[field] = value;
    }
}

async function deleteVolunteer(id) {
    if (confirm('Hapus volunteer ini?')) {
        const rekruter = rekruters.find(r => r.id === selectedRekruterId);
        if (rekruter) {
            // Hapus dari array lokal
            rekruter.volunteers = rekruter.volunteers.filter(v => v.id !== id);
            
            // Simpan perubahan array tersebut ke Supabase
            await saveData(); 
            renderVolunteerTable();
        }
    }
}

function viewVolunteerDetail(id) {
    selectedVolunteerId = id;
    document.getElementById('volunteerListPage').style.display = 'none';
    document.getElementById('volunteerDetailPage').style.display = 'block';
    renderVolunteerDetail();
    saveCurrentPage('volunteerDetail'); // 🆕 Simpan state
}

function backToVolunteerList() {
    selectedVolunteerId = null;
    document.getElementById('volunteerDetailPage').style.display = 'none';
    document.getElementById('volunteerListPage').style.display = 'block';
    saveCurrentPage('volunteerList'); // 🆕 Simpan state
}

function renderVolunteerTable() {
    const rekruter = rekruters.find(r => r.id === selectedRekruterId);
    if (!rekruter) return;
    
    const tbody = document.getElementById('volunteerTableBody');
    tbody.innerHTML = '';
    
    rekruter.volunteers.forEach((volunteer, index) => {
        const tr = document.createElement('tr');
        
        if (editingVolunteerId === volunteer.id) {
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>
                    <input type="text" value="${volunteer.nama}" 
                        class="table-input"
                        onchange="updateVolunteerField(${volunteer.id}, 'nama', this.value)">
                </td>
                <td>
                    <select class="table-input" 
                        onchange="updateVolunteerField(${volunteer.id}, 'status', this.value)">
                        ${['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'].map(t => 
                            `<option value="${t}" ${volunteer.status === t ? 'selected' : ''}>${t}</option>`
                        ).join('')}
                    </select>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon save" onclick="saveVolunteerEdit(${volunteer.id})">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </button>
                        <button class="btn-icon delete" onclick="deleteVolunteer(${volunteer.id})">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </td>
            `;
        } else {
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>
                    <button class="btn-link" onclick="viewVolunteerDetail(${volunteer.id})">
                        ${volunteer.nama || 'Belum diisi'}
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </button>
                </td>
                <td>
                    <span class="status-badge">${volunteer.status}</span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon edit" onclick="editVolunteer(${volunteer.id})">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="btn-icon delete" onclick="deleteVolunteer(${volunteer.id})">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </td>
            `;
        }
        
        tbody.appendChild(tr);
    });
}

// Volunteer Detail Functions
function renderVolunteerDetail() {
    const rekruter = rekruters.find(r => r.id === selectedRekruterId);
    const volunteer = rekruter.volunteers.find(v => v.id === selectedVolunteerId);
    if (!volunteer) return;
    
    renderBiodata(volunteer);
    renderTahapan(volunteer);
    renderNotes(volunteer);
    renderStatus(volunteer);
}

function toggleEditBiodata() {
    isEditingBiodata = !isEditingBiodata;
    const rekruter = rekruters.find(r => r.id === selectedRekruterId);
    const volunteer = rekruter.volunteers.find(v => v.id === selectedVolunteerId);
    
    document.getElementById('editBiodataText').textContent = isEditingBiodata ? 'Simpan' : 'Edit';
    
    if (!isEditingBiodata) {
        saveData();
    }
    
    renderBiodata(volunteer);
}

function renderBiodata(volunteer) {
    const form = document.getElementById('biodataForm');
    const fields = [
        { key: 'namaLengkap', label: 'Nama Lengkap' },
        { key: 'nik', label: 'Jenis Kelamin' },
        { key: 'tempatLahir', label: 'Usia' },
        { key: 'tanggalLahir', label: 'No Hp' },
        { key: 'jenisKelamin', label: 'Segmen' },
        { key: 'agama', label: 'Domisili' },
        { key: 'pendidikan', label: 'Pendidikan' },
        { key: 'pekerjaan', label: 'Institusi' },
        { key: 'alamat', label: 'Semester' },
        { key: 'kota', label: 'Fakultas' },
        { key: 'provinsi', label: 'Jurusan' },
        { key: 'noTelepon', label: 'Profil' },
        { key: 'email', label: 'Buku Bacaan' },
        { key: 'statusPerkawinan', label: 'Tokoh' },
        { key: 'keterampilan', label: 'Komunikasi' }
    ];
    
    form.innerHTML = fields.map(field => `
        <div class="form-group">
            <label>${field.label}</label>
            ${isEditingBiodata ? `
                <input type="text" 
                    value="${volunteer.biodata[field.key] || ''}"
                    onchange="updateBiodata('${field.key}', this.value)">
            ` : `
                <p>${volunteer.biodata[field.key] || '-'}</p>
            `}
        </div>
    `).join('');
}

function updateBiodata(field, value) {
    const rekruter = rekruters.find(r => r.id === selectedRekruterId);
    const volunteer = rekruter.volunteers.find(v => v.id === selectedVolunteerId);
    volunteer.biodata[field] = value;
}

function renderTahapan(volunteer) {
    const grid = document.getElementById('tahapanGrid');
    const tahapans = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
    const labels = { T6: '(OV)', T7: '(MV)', T8: '(HV)' };
    
    // Last communication
    const dates = Object.values(volunteer.tahapan).filter(d => d !== null);
    if (dates.length > 0) {
        const lastDate = new Date(Math.max(...dates.map(d => new Date(d))));
        document.getElementById('lastCommunication').style.display = 'block';
        document.getElementById('lastCommDate').textContent = lastDate.toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } else {
        document.getElementById('lastCommunication').style.display = 'none';
    }
    
    grid.innerHTML = tahapans.map(t => `
        <button class="tahapan-button ${volunteer.tahapan[t] ? 'active' : ''}"
            onclick="toggleTahapan('${t}')">
            <div class="tahapan-title">${t}</div>
            ${volunteer.tahapan[t] ? `
                <div class="tahapan-date">
                    ${new Date(volunteer.tahapan[t]).toLocaleDateString('id-ID')}
                </div>
            ` : ''}
            ${labels[t] ? `<div class="tahapan-label">${labels[t]}</div>` : ''}
        </button>
    `).join('');
}

// 🆕 FITUR 2: TOGGLE TAHAPAN (BISA CANCEL)
function toggleTahapan(tahap) {
    const rekruter = rekruters.find(r => r.id === selectedRekruterId);
    const volunteer = rekruter.volunteers.find(v => v.id === selectedVolunteerId);
    
    // Jika sudah aktif, batalkan (set null)
    if (volunteer.tahapan[tahap] !== null) {
        if (confirm(`Batalkan tahapan ${tahap}?`)) {
            volunteer.tahapan[tahap] = null;
            
            // Update status ke tahapan tertinggi yang masih aktif
            let highestActive = 'T1';
            for (let i = 8; i >= 1; i--) {
                const t = `T${i}`;
                if (volunteer.tahapan[t] !== null) {
                    highestActive = t;
                    break;
                }
            }
            volunteer.status = highestActive;
        } else {
            return; // User membatalkan konfirmasi
        }
    } else {
        // Jika belum aktif, aktifkan
        volunteer.tahapan[tahap] = new Date().toISOString();
        volunteer.status = tahap;
    }
    
    saveData();
    renderVolunteerDetail();
}

function renderNotes(volunteer) {
    document.getElementById('notesGoals').value = volunteer.notes.goals;
    document.getElementById('notesOutput').value = volunteer.notes.output;
    document.getElementById('notesOutcome').value = volunteer.notes.outcome;
}

function saveVolunteerNotes() {
    const rekruter = rekruters.find(r => r.id === selectedRekruterId);
    const volunteer = rekruter.volunteers.find(v => v.id === selectedVolunteerId);
    
    volunteer.notes.goals = document.getElementById('notesGoals').value;
    volunteer.notes.output = document.getElementById('notesOutput').value;
    volunteer.notes.outcome = document.getElementById('notesOutcome').value;
    
    saveData();
}

function renderStatus(volunteer) {
    const statusNum = parseInt(volunteer.status.replace('T', ''));
    const progress = (statusNum / 8 * 100).toFixed(0);
    const completed = Object.values(volunteer.tahapan).filter(t => t !== null).length;
    
    document.getElementById('currentStatus').textContent = volunteer.status;
    document.getElementById('progressPercent').textContent = progress + '%';
    document.getElementById('progressFill').style.width = progress + '%';
    document.getElementById('completedStages').textContent = `${completed} / 8`;
}

function renderSummary() {
    const summary = calculateSummary();
    
    // 1. Kotak Rekruter & Total (4 Kotak)
    const rekruterCards = [
        { label: 'Total Rekruter', value: summary.totalRekruter, color: 'bg-blue' },
        { label: 'Belum Punya Volunteer', value: summary.rekruterWithoutVolunteers, color: 'bg-red' },
        { label: 'Sudah Punya Volunteer', value: summary.rekruterWithVolunteers, color: 'bg-green' },
        { label: 'Total Volunteer', value: summary.totalVolunteers, color: 'bg-purple' }
    ];

    // 2. Kotak Tahapan (8 Kotak)
    const tahapanCards = [
        { label: 'Total T1', value: summary.T1, color: 'bg-indigo' },
        { label: 'Total T2', value: summary.T2, color: 'bg-pink' },
        { label: 'Total T3', value: summary.T3, color: 'bg-orange' },
        { label: 'Total T4', value: summary.T4, color: 'bg-teal' },
        { label: 'Total T5', value: summary.T5, color: 'bg-cyan' },
        { label: 'Total T6 (OV)', value: summary.T6, color: 'bg-emerald' },
        { label: 'Total T7 (MV)', value: summary.T7, color: 'bg-lime' },
        { label: 'Total T8 (HV)', value: summary.T8, color: 'bg-amber' }
    ];

    // 3. Kotak Potensi (3 Kotak)
    const potensiCards = [
        { label: 'Potensi Grouping', value: summary.potensiGrouping, color: 'bg-violet', note: '≥4 volunteer di T3' },
        { label: 'Grouping', value: summary.grouping, color: 'bg-fuchsia', note: '≥4 volunteer di T4' },
        { label: 'Interpersonal', value: summary.interpersonal, color: 'bg-rose', note: '<4 volunteer di T1-T3' }
    ];

    // Fungsi pembantu untuk membuat HTML kartu
    const createCardsHTML = (cards) => cards.map(card => `
        <div class="summary-card ${card.color}">
            <div class="summary-label">${card.label}</div>
            <div class="summary-value">${card.value}</div>
            ${card.note ? `<div class="summary-note">${card.note}</div>` : ''}
        </div>
    `).join('');

    // Masukkan ke masing-masing section
    document.getElementById('summaryRekruter').innerHTML = createCardsHTML(rekruterCards);
    document.getElementById('summaryTahapan').innerHTML = createCardsHTML(tahapanCards);
    document.getElementById('summaryPotensi').innerHTML = createCardsHTML(potensiCards);
}

function calculateSummary() {
    const totalRekruter = rekruters.length;
    const rekruterWithVolunteers = rekruters.filter(r => r.volunteers.length > 0).length;
    const rekruterWithoutVolunteers = totalRekruter - rekruterWithVolunteers;
    
    let totalVolunteers = 0;
    let statusCounts = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0, T6: 0, T7: 0, T8: 0 };
    
    rekruters.forEach(r => {
        totalVolunteers += r.volunteers.length;
        r.volunteers.forEach(v => {
            statusCounts[v.status]++;
        });
    });
    
    let potensiGrouping = 0;
    let grouping = 0;
    let interpersonal = 0;
    
    rekruters.forEach(r => {
        const t3Count = r.volunteers.filter(v => v.status === 'T3').length;
        const t4Count = r.volunteers.filter(v => v.status === 'T4').length;
        const belowT4 = r.volunteers.filter(v => ['T1', 'T2', 'T3'].includes(v.status)).length;
        
        if (t3Count >= 4) potensiGrouping++;
        if (t4Count >= 4) grouping++;
        if (belowT4 > 0 && belowT4 < 4) interpersonal++;
    });
    
    return {
        totalRekruter,
        rekruterWithoutVolunteers,
        rekruterWithVolunteers,
        totalVolunteers,
        ...statusCounts,
        potensiGrouping,
        grouping,
        interpersonal
    };
}

// Utility Functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function setupRealtime() {
    sb.channel('db-live').on('postgres_changes', 
        { event: '*', schema: 'public', table: 'volunteers' }, 
        () => {
            // HANYA refresh jika tidak sedang edit rekruter atau volunteer
            if (editingRekruterId === null && editingVolunteerId === null && isEditingBiodata === false) {
                loadData();
            } else {
                console.log("Menunda refresh agar input tidak loncat...");
            }
        }
    ).subscribe();
}

// ==========================================
// FITUR TREATMENT / RENCANA TINDAK LANJUT
// ==========================================

// 1. Hitung Statistik (Upgrading, Prioritas, Khusus)
function renderTreatmentStats() {
    let countUpgrading = 0;
    let countPrioritas = 0;
    let countKhusus = 0;

    rekruters.forEach(r => {
        const totalVol = r.volunteers.length;
        const t4Count = r.volunteers.filter(v => v.status === 'T4').length;
        
        if (totalVol === 0) {
            countKhusus++;
        } else if (t4Count >= 4) {
            countUpgrading++;
        } else {
            countPrioritas++;
        }
    });

    document.getElementById('countUpgrading').textContent = countUpgrading;
    document.getElementById('countPrioritas').textContent = countPrioritas;
    document.getElementById('countKhusus').textContent = countKhusus;
}

// 2. Load Data Treatment dari Supabase
async function loadTreatments() {
    const { data, error } = await sb.from('treatments').select('*').order('rencana_aksi', { ascending: true });
    if (error) {
        console.error('Gagal ambil treatment:', error);
    } else {
        treatments = data;
        renderTreatmentTable();
    }
    
    // Siapkan dropdown nama rekruter
    const select = document.getElementById('inputKepada');
    select.innerHTML = '<option value="">-- Pilih Rekruter --</option>';
    rekruters.forEach(r => {
        select.innerHTML += `<option value="${r.id}">${r.namaRekruter}</option>`;
    });
}

// 3. Simpan Treatment Baru
async function saveTreatment() {
    const pic = document.getElementById('inputPIC').value;
    const status = document.getElementById('inputStatusTreatment').value;
    const rekruterId = document.getElementById('inputKepada').value;
    const tgl = document.getElementById('inputTanggal').value;
    const tempat = document.getElementById('inputTempat').value;
    const waktu = document.getElementById('inputWaktu').value;
    const target = document.getElementById('inputTarget').value;

    if (!rekruterId || !tgl) {
        alert("Mohon pilih Rekruter dan Tanggal Rencana Aksi");
        return;
    }

    const newTreatment = {
        id: Date.now(),
        pic: pic,
        status_treatment: status,
        rekruter_id: rekruterId,
        rencana_aksi: tgl,
        tempat: tempat,
        waktu: waktu,
        target: target,
        realisasi: 0
    };

    const { error } = await sb.from('treatments').insert(newTreatment);
    
    if (error) {
        alert("Gagal simpan: " + error.message);
    } else {
        loadTreatments();
        hideAddTreatment();
    }
}

// 4. Update Angka Realisasi (Warna)
async function updateRealisasi(id, currentVal) {
    let newVal = currentVal + 1;
    if (newVal > 3) newVal = 0;

    const { error } = await sb.from('treatments').update({ realisasi: newVal }).eq('id', id);
    
    if (error) {
        alert("Gagal update status: " + error.message);
    } else {
        loadTreatments();
    }
}

// 5. Hapus Treatment
async function deleteTreatment(id) {
    if(confirm("Hapus rencana ini?")) {
        const { error } = await sb.from('treatments').delete().eq('id', id);
        if(!error) loadTreatments();
    }
}

// 6. Render Tabel
function renderTreatmentTable() {
    const tbody = document.getElementById('treatmentTableBody');
    tbody.innerHTML = '';

    treatments.forEach(t => {
        const rekruter = rekruters.find(r => r.id == t.rekruter_id);
        const namaRekruter = rekruter ? rekruter.namaRekruter : 'Rekruter Terhapus';

        const dateObj = new Date(t.rencana_aksi);
        const dateStr = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${t.pic}</strong></td>
            <td><span class="status-badge">${t.status_treatment}</span></td>
            <td>${namaRekruter}</td>
            <td>
                <div>${dateStr}</div>
                <small style="color:var(--gray-500)">${t.waktu}</small>
            </td>
            <td>${t.tempat}</td>
            <td>${t.target}</td>
            <td>
                <div class="realisasi-box realisasi-${t.realisasi}" 
                     onclick="updateRealisasi(${t.id}, ${t.realisasi})"
                     title="Klik untuk ubah status">
                    ${t.realisasi === 0 ? '-' : t.realisasi}
                </div>
            </td>
            <td>
                <button class="btn-icon delete" onclick="deleteTreatment(${t.id})">
                     <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function showAddTreatment() {
    document.getElementById('addTreatmentForm').style.display = 'block';
}

function hideAddTreatment() {
    document.getElementById('addTreatmentForm').style.display = 'none';
}

async function showLastUpdate() {
    const { data, error } = await sb.from('volunteers')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1);

    if (data && data[0]) {
        const d = new Date(data[0].updated_at);
        const options = { 
            weekday: 'long', 
            day: 'numeric', 
            month: 'short', 
            year: 'numeric',
            hour: '2-digit', 
            minute: '2-digit' 
        };
        const formattedDate = d.toLocaleDateString('id-ID', options);
        document.getElementById('lastUpdateLabel').innerText = formattedDate;
    }
}