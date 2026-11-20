// Model: conexão com o banco MySQL (db_sive). Todos os outros arquivos usam esta mesma conexão.
const mysql = require("mysql2/promise");
const { config } = require("../../config");

module.exports = mysql.createPool(config.banco);
