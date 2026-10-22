// Prueba rápida de conexión: node test-db.js
const pool = require("./db");

async function probarConexion() {
    try {
        const [resultado] = await pool.query("SELECT 1 AS conectado");

        console.log("✅ Conexión exitosa con PostgreSQL (Supabase)");
        console.log(resultado);

        process.exit(0);
    } catch (error) {
        console.error("❌ Error conectando a la base de datos:");
        console.error(error.message);

        process.exit(1);
    }
}

probarConexion();
