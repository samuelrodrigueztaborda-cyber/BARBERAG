// backend/ecosystem.config.js
// Configuración de PM2 — mantiene el backend corriendo en segundo plano,
// lo reinicia solo si se cae, y guarda logs. Alternativa a Docker para
// quien despliega directo en un VPS.
//
// Instalación:  npm install -g pm2
// Arrancar:     pm2 start ecosystem.config.js
// Ver logs:     pm2 logs barberag-api
// Reiniciar:    pm2 restart barberag-api
// Autoarranque al reiniciar el servidor:  pm2 startup   (sigue las instrucciones que imprime)
//                                          pm2 save

module.exports = {
  apps: [
    {
      name: "barberag-api",
      script: "server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
