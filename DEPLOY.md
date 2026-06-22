# Guía de despliegue en VPS (SSH)

## 1. Ejecutar el schema en Supabase

Ve a tu proyecto Supabase → SQL Editor → pega y ejecuta `supabase-schema.sql`.

## 2. Subir el proyecto al VPS

Desde tu máquina local:

```bash
# Subir archivos (excluye node_modules y .env)
rsync -avz --exclude='node_modules' --exclude='.env' \
  /home/deymer-gamba/Descargas/Web_TFG/Web_TFG/ \
  usuario@IP_DEL_VPS:/var/www/growai/

# O con scp si no tienes rsync
scp -r /home/deymer-gamba/Descargas/Web_TFG/Web_TFG/ usuario@IP_DEL_VPS:/var/www/growai/
```

## 3. En el servidor VPS (via SSH)

```bash
ssh usuario@IP_DEL_VPS

# Instalar Node.js si no está (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Instalar PM2 (gestor de procesos)
sudo npm install -g pm2

# Ir al directorio
cd /var/www/growai

# Instalar dependencias
npm install

# Crear el archivo .env con tus credenciales reales
nano .env
```

Contenido del `.env` en el servidor:
```
PORT=5500
HOST=0.0.0.0
SESSION_SECRET=una_clave_muy_larga_y_aleatoria_aqui

SUPABASE_URL=https://TUPROYECTO.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.TU_CLAVE_AQUI
```

```bash
# Arrancar con PM2
pm2 start ServidorPrincipal.js --name growai

# Que arranque solo al reiniciar el servidor
pm2 startup
pm2 save
```

## 4. (Opcional) Nginx como reverse proxy

Si quieres usar el puerto 80/443 instala Nginx:

```bash
sudo apt install nginx -y
```

Crea `/etc/nginx/sites-available/growai`:
```nginx
server {
    listen 80;
    server_name TU_DOMINIO_O_IP;

    location / {
        proxy_pass http://localhost:5500;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/growai /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Verificar

```bash
pm2 status          # Ver que el proceso está corriendo
pm2 logs growai     # Ver logs en tiempo real
```
