import 'dotenv/config';

export default {
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    database: process.env.DB_NAME || 'socai',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
};
