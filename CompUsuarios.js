// Usuarios definidos en server.js
const usuarios = {
  "maria": "123456",
  "carlos": "abc123"
};

// Función para listar usuarios
console.log("Usuarios disponibles:");
for (const user in usuarios) {
  console.log(`Usuario: ${user} | Contraseña: ${usuarios[user]}`);
}

// Ejemplo: comprobar si un login funciona
const testUser = "maria";
const testPass = "123456";

if (usuarios[testUser] && usuarios[testUser] === testPass) {
  console.log(`✅ Login correcto para ${testUser}`);
} else {
  console.log(`❌ Login fallido para ${testUser}`);
}