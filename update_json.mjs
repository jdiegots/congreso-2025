import fs from 'fs';
import path from 'path';

const filePath = path.join(process.cwd(), 'public/data/iniciativas.json');

const jsonString = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
const data = JSON.parse(jsonString);

// Update tipo based on titulo
for (const item of data) {
    const titulo = (item.titulo || '').trim();
    // Check what type it should be
    if (titulo.toLowerCase().startsWith('ley orgánica') || titulo.toLowerCase().startsWith('ley organica')) {
        item.tipo = 'Leyes organicas';
    } else if (titulo.toLowerCase().startsWith('real decreto-ley')) {
        item.tipo = 'Reales decretos';
    } else {
        // Everything else is Leyes
        item.tipo = 'Leyes';
    }
}

// Write back
fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf-8');

console.log('Updated iniciativas.json');

// Count by tipo
const tipos = {};
for (const item of data) {
    const t = item.tipo;
    tipos[t] = (tipos[t] || 0) + 1;
}

console.log('Counts:');
for (const t of Object.keys(tipos).sort()) {
    console.log(`  ${t}: ${tipos[t]}`);
}
