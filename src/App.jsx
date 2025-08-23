import { useState, useEffect } from 'react'
import PocketBase from 'pocketbase'

function App() {
  const [screen, setScreen] = useState('loading')
  const [users, setUsers] = useState([])
  const [loans, setLoans] = useState([])
  const [currentUser, setCurrentUser] = useState(null)
  const [error, setError] = useState('')
  
  // Inicializa o PocketBase
  const pb = new PocketBase('http://127.0.0.1:8091')
  
  // Configuração de juros
  const INTEREST_RATE = 0.018; // 1.8% ao mês

  // Funções de utilidade
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  }

  const calculateLoan = (amount, termInDays, installments) => {
    const termInMonths = termInDays / 30;
    const totalAmount = amount * Math.pow(1 + INTEREST_RATE, termInMonths);
    const installmentAmount = totalAmount / installments;
    
    return {
      totalAmount,
      installmentAmount,
      interestAmount: totalAmount - amount
    };
  }

  // Carrega os dados iniciais
  const loadData = async () => {
    try {
      const usersList = await pb.collection('users').getFullList();
      const loansList = await pb.collection('loans').getFullList();
      
      setUsers(usersList);
      setLoans(loansList);
      
      // Verifica se há usuário logado
      const storedUser = localStorage.getItem('bank_currentUser');
      if (storedUser) {
        const user = usersList.find(u => u.id === storedUser);
        if (user) {
          setCurrentUser(user);
          setScreen(user.is_admin ? 'admin' : 'user');
          return;
        }
      }
      
      setScreen('login');
    } catch (err) {
      setError('Erro ao carregar dados: ' + err.message);
      setScreen('setup');
    }
  }

  // Configura o banco de dados
  const setupDatabase = async () => {
    try {
      // Cria coleção de usuários se não existir
      try {
        await pb.collections.create({
          name: 'users',
          type: 'base',
          schema: [
            { name: 'name', type: 'text', required: true },
            { name: 'email', type: 'email', required: true, unique: true },
            { name: 'password', type: 'text', required: true },
            { name: 'balance', type: 'number', required: true, default: 0 },
            { name: 'group', type: 'number', required: true },
            { name: 'is_admin', type: 'bool', required: true, default: false },
            { name: 'transactions', type: 'json', required: true, default: '[]' }
          ]
        });
      } catch (e) {
        // Coleção já existe, tudo bem
      }

      // Cria coleção de empréstimos se não existir
      try {
        await pb.collections.create({
          name: 'loans',
          type: 'base',
          schema: [
            { name: 'user_id', type: 'text', required: true },
            { name: 'amount', type: 'number', required: true },
            { name: 'term_in_days', type: 'number', required: true },
            { name: 'installments', type: 'number', required: true },
            { name: 'status', type: 'text', required: true, default: 'pending' }
          ]
        });
      } catch (e) {
        // Coleção já existe, tudo bem
      }

      // Cria usuário admin se não existir
      try {
        await pb.collection('users').create({
          name: 'Administrador',
          email: 'admin@example.com',
          password: 'admin123',
          balance: 10000,
          group: 1,
          is_admin: true,
          transactions: []
        });
      } catch (e) {
        // Usuário já existe, tudo bem
      }

      await loadData();
    } catch (err) {
      setError('Erro ao configurar banco: ' + err.message);
    }
  }

  // Funções de autenticação
  const handleLogin = async (e) => {
    e.preventDefault();
    const email = e.target.email.value;
    const password = e.target.password.value;
    
    try {
      const authData = await pb.collection('users').getList(1, 1, {
        filter: `email = "${email}" && password = "${password}"`
      });
      
      if (authData.items.length > 0) {
        const user = authData.items[0];
        setCurrentUser(user);
        localStorage.setItem('bank_currentUser', user.id);
        
        if (user.is_admin) {
          setScreen('admin');
        } else {
          setScreen('user');
        }
      } else {
        setError('E-mail ou senha incorretos!');
      }
    } catch (err) {
      setError('Erro ao fazer login: ' + err.message);
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault();
    const name = e.target.name.value;
    const email = e.target.email.value;
    const password = e.target.password.value;
    const group = parseInt(e.target.group.value);
    
    try {
      const newUser = await pb.collection('users').create({
        name,
        email,
        password,
        balance: 0,
        group,
        is_admin: false,
        transactions: []
      });
      
      setCurrentUser(newUser);
      localStorage.setItem('bank_currentUser', newUser.id);
      setScreen('user');
      setError('');
    } catch (err) {
      setError('Erro ao criar conta: ' + err.message);
    }
  }

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('bank_currentUser');
    setScreen('login');
  }

  // Funções de transferência
  const handleTransfer = async (e) => {
    e.preventDefault();
    const recipientEmail = e.target.recipient.value;
    const amount = parseFloat(e.target.amount.value);
    
    try {
      // Encontra o destinatário
      const recipientData = await pb.collection('users').getList(1, 1, {
        filter: `email = "${recipientEmail}"`
      });
      
      if (recipientData.items.length === 0) {
        setError('Destinatário não encontrado!');
        return;
      }
      
      const recipient = recipientData.items[0];
      
      // Verifica saldo
      if (amount > currentUser.balance) {
        setError('Saldo insuficiente!');
        return;
      }
      
      // Atualiza remetente
      const newSenderBalance = currentUser.balance - amount;
      const senderTransactions = [...currentUser.transactions, {
        type: `Transferência para ${recipient.name}`,
        amount: -amount,
        date: new Date().toISOString()
      }];
      
      // Atualiza destinatário
      const newRecipientBalance = recipient.balance + amount;
      const recipientTransactions = [...recipient.transactions, {
        type: `Recebimento de ${currentUser.name}`,
        amount: amount,
        date: new Date().toISOString()
      }];
      
      // Salva no banco
      await Promise.all([
        pb.collection('users').update(currentUser.id, {
          balance: newSenderBalance,
          transactions: senderTransactions
        }),
        pb.collection('users').update(recipient.id, {
          balance: newRecipientBalance,
          transactions: recipientTransactions
        })
      ]);
      
      // Atualiza estado local
      const updatedSender = { ...currentUser, balance: newSenderBalance, transactions: senderTransactions };
      setCurrentUser(updatedSender);
      setUsers(users.map(u => 
        u.id === currentUser.id ? updatedSender : 
        u.id === recipient.id ? { ...recipient, balance: newRecipientBalance, transactions: recipientTransactions } : 
        u
      ));
      
      // Limpa formulário
      e.target.reset();
      setError('');
      alert('Transferência realizada com sucesso!');
    } catch (err) {
      setError('Erro na transferência: ' + err.message);
    }
  }

  // Funções de empréstimo
  const handleLoanRequest = async (e) => {
    e.preventDefault();
    const amount = parseFloat(e.target.amount.value);
    const termInDays = parseInt(e.target.term.value);
    const installments = parseInt(e.target.installments.value);
    
    try {
      // Cria solicitação de empréstimo
      await pb.collection('loans').create({
        user_id: currentUser.id,
        amount,
        term_in_days: termInDays,
        installments,
        status: 'pending'
      });
      
      // Atualiza lista de empréstimos
      const loansList = await pb.collection('loans').getFullList();
      setLoans(loansList);
      
      // Limpa formulário
      e.target.reset();
      setError('');
      alert('Solicitação de empréstimo enviada com sucesso!');
    } catch (err) {
      setError('Erro ao solicitar empréstimo: ' + err.message);
    }
  }

  const handleApproveLoan = async (loanId) => {
    try {
      // Encontra o empréstimo
      const loan = loans.find(l => l.id === loanId);
      if (!loan) return;
      
      // Encontra o usuário
      const user = users.find(u => u.id === loan.user_id);
      if (!user) return;
      
      // Calcula detalhes
      const calculation = calculateLoan(loan.amount, loan.term_in_days, loan.installments);
      
      // Atualiza saldo do usuário
      const newBalance = user.balance + loan.amount;
      
      // Adiciona transação
      const newTransactions = [...user.transactions, {
        type: `Empréstimo aprovado (${loan.installments}x)`,
        amount: loan.amount,
        date: new Date().toISOString(),
        loanDetails: {
          id: loan.id,
          amount: loan.amount,
          termInDays: loan.term_in_days,
          installments: loan.installments,
          totalAmount: calculation.totalAmount,
          installmentAmount: calculation.installmentAmount
        }
      }];
      
      // Atualiza usuário
      await pb.collection('users').update(user.id, {
        balance: newBalance,
        transactions: newTransactions
      });
      
      // Atualiza empréstimo
      await pb.collection('loans').update(loan.id, {
        status: 'approved'
      });
      
      // Atualiza estado local
      const updatedUser = { ...user, balance: newBalance, transactions: newTransactions };
      setCurrentUser(updatedUser);
      setUsers(users.map(u => u.id === user.id ? updatedUser : u));
      setLoans(loans.filter(l => l.id !== loan.id));
      
      alert('Empréstimo aprovado com sucesso!');
    } catch (err) {
      setError('Erro ao aprovar empréstimo: ' + err.message);
    }
  }

  const handleRejectLoan = async (loanId) => {
    try {
      await pb.collection('loans').delete(loanId);
      setLoans(loans.filter(l => l.id !== loanId));
      alert('Solicitação rejeitada!');
    } catch (err) {
      setError('Erro ao rejeitar solicitação: ' + err.message);
    }
  }

  // Efeito inicial
  useEffect(() => {
    setupDatabase();
  }, []);

  // Renderização
  if (screen === 'loading') {
    return (
      <div className="card">
        <div className="loading-spinner" style={{ 
          border: '4px solid rgba(0, 0, 0, 0.1)',
          borderRadius: '50%',
          borderTop: '4px solid #3498db',
          width: '40px',
          height: '40px',
          animation: 'spin 1s linear infinite',
          margin: '20px auto'
        }}></div>
        <p>Configurando sistema...</p>
      </div>
    );
  }

  if (screen === 'setup') {
    return (
      <div className="card" style={{ backgroundColor: '#fff8e1', borderLeft: '4px solid #ffc107' }}>
        <h3 style={{ color: '#e65100', marginBottom: '10px' }}>Configuração Necessária</h3>
        <p>Para executar este sistema:</p>
        <ol style={{ paddingLeft: '20px' }}>
          <li>Instale o PocketBase: <a href="https://pocketbase.io/docs/" target="_blank">Baixar PocketBase</a></li>
          <li>Extraia o arquivo na pasta do projeto</li>
          <li>Execute o PocketBase (veja instruções abaixo)</li>
          <li>Recarregue esta página</li>
        </ol>
        <h4 style={{ marginTop: '15px' }}>Como executar o PocketBase:</h4>
        <ul style={{ paddingLeft: '20px' }}>
          <li><strong>Windows:</strong> Execute o arquivo pocketbase.exe</li>
          <li><strong>Mac:</strong> Abra o terminal e execute: ./pocketbase</li>
          <li><strong>Linux:</strong> Abra o terminal e execute: ./pocketbase</li>
        </ul>
        {error && <p style={{ color: '#e74c3c', marginTop: '10px' }}>{error}</p>}
      </div>
    );
  }

  // Tela de Login
  if (screen === 'login') {
    return (
      <div className="card">
        <h2 className="card-header">Acesse sua conta</h2>
        <div className="card-body">
          {error && <p style={{ color: '#e74c3c', marginBottom: '15px' }}>{error}</p>}
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>E-mail</label>
              <input type="email" name="email" placeholder="seu@email.com" required />
            </div>
            <div className="form-group">
              <label>Senha</label>
              <input type="password" name="password" placeholder="Sua senha" required />
            </div>
            <button type="submit">Entrar</button>
          </form>
          <div style={{ textAlign: 'center', marginTop: '15px' }}>
            <p>Não tem uma conta?{' '}
              <button onClick={() => setScreen('register')} 
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        color: '#3498db', 
                        cursor: 'pointer', 
                        padding: 0 
                      }}>
                Registre-se
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Tela de Registro
  if (screen === 'register') {
    return (
      <div className="card">
        <h2 className="card-header">Crie sua conta</h2>
        <div className="card-body">
          {error && <p style={{ color: '#e74c3c', marginBottom: '15px' }}>{error}</p>}
          <form onSubmit={handleRegister}>
            <div className="form-group">
              <label>Seu nome completo</label>
              <input type="text" name="name" placeholder="Seu nome" required />
            </div>
            <div className="form-group">
              <label>E-mail</label>
              <input type="email" name="email" placeholder="seu@email.com" required />
            </div>
            <div className="form-group">
              <label>Senha</label>
              <input type="password" name="password" placeholder="Sua senha" required />
            </div>
            <div className="form-group">
              <label>Selecione seu grupo</label>
              <select name="group" required>
                <option value="1">Grupo 1</option>
                <option value="2">Grupo 2</option>
                <option value="3">Grupo 3</option>
                <option value="4">Grupo 4</option>
              </select>
            </div>
            <button type="submit">Registrar</button>
          </form>
          <div style={{ textAlign: 'center', marginTop: '15px' }}>
            <p>Já tem uma conta?{' '}
              <button onClick={() => setScreen('login')} 
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        color: '#3498db', 
                        cursor: 'pointer', 
                        padding: 0 
                      }}>
                Faça login
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Painel do Usuário
  if (screen === 'user' && currentUser) {
    return (
      <div>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '20px',
          padding: '10px 0'
        }}>
          <h2 style={{ fontSize: '1.5rem', color: '#2c3e50' }}>Bem-vindo, {currentUser.name}</h2>
          <button 
            onClick={handleLogout}
            style={{ 
              background: '#e74c3c', 
              color: 'white', 
              border: 'none', 
              padding: '8px 15px', 
              borderRadius: '8px',
              cursor: 'pointer'
            }}>
            Sair
          </button>
        </div>

        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
          gap: '20px',
          marginBottom: '30px'
        }}>
          <div style={{ 
            background: 'white', 
            borderRadius: '15px', 
            boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
            padding: '25px'
          }}>
            <div style={{ 
              textAlign: 'center', 
              padding: '20px', 
              borderRadius: '10px', 
              background: '#3498db', 
              color: 'white'
            }}>
              <h3 style={{ fontSize: '1.2rem', marginBottom: '10px', opacity: 0.9 }}>Saldo Atual</h3>
              <div style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>
                {formatCurrency(currentUser.balance)}
              </div>
            </div>
          </div>

          <div style={{ 
            background: 'white', 
            borderRadius: '15px', 
            boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
            padding: '25px'
          }}>
            <h3 style={{ marginBottom: '15px', color: '#2c3e50' }}>Transferir Dinheiro</h3>
            <form onSubmit={handleTransfer}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ 
                  display: 'block', 
                  marginBottom: '8px', 
                  fontWeight: '600', 
                  color: '#2c3e50' 
                }}>E-mail do destinatário</label>
                <input type="email" name="recipient" placeholder="amigo@email.com" 
                       style={{ 
                         width: '100%', 
                         padding: '12px', 
                         border: '2px solid #e0e0e0', 
                         borderRadius: '8px',
                         fontSize: '16px'
                       }} required />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ 
                  display: 'block', 
                  marginBottom: '8px', 
                  fontWeight: '600', 
                  color: '#2c3e50' 
                }}>Valor</label>
                <input type="number" name="amount" min="0.01" step="0.01" placeholder="0.00"
                       style={{ 
                         width: '100%', 
                         padding: '12px', 
                         border: '2px solid #e0e0e0', 
                         borderRadius: '8px',
                         fontSize: '16px'
                       }} required />
              </div>
              <button type="submit" style={{ 
                background: '#3498db',
                color: 'white',
                border: 'none',
                padding: '12px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '600',
                width: '100%',
                transition: 'background 0.3s'
              }}>Transferir</button>
            </form>
          </div>

          <div style={{ 
            background: 'white', 
            borderRadius: '15px', 
            boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
            padding: '25px'
          }}>
            <h3 style={{ marginBottom: '15px', color: '#2c3e50' }}>Solicitar Empréstimo</h3>
            <form onSubmit={handleLoanRequest}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ 
                  display: 'block', 
                  marginBottom: '8px', 
                  fontWeight: '600', 
                  color: '#2c3e50' 
                }}>Valor do empréstimo</label>
                <input type="number" name="amount" min="1" placeholder="100"
                       style={{ 
                         width: '100%', 
                         padding: '12px', 
                         border: '2px solid #e0e0e0', 
                         borderRadius: '8px',
                         fontSize: '16px'
                       }} required />
              </div>
              
              <div style={{ marginBottom: '20px' }}>
                <label style={{ 
                  display: 'block', 
                  marginBottom: '8px', 
                  fontWeight: '600', 
                  color: '#2c3e50' 
                }}>Prazo para pagamento</label>
                <div style={{ display: 'flex' }}>
                  <span style={{ 
                    display: 'inline-block', 
                    margin: '5px', 
                    padding: '8px 15px', 
                    background: '#e0e0e0', 
                    borderRadius: '20px', 
                    cursor: 'pointer'
                  }} data-term="15">15 dias</span>
                  <span style={{ 
                    display: 'inline-block', 
                    margin: '5px', 
                    padding: '8px 15px', 
                    background: '#e0e0e0', 
                    borderRadius: '20px', 
                    cursor: 'pointer'
                  }} data-term="30">1 mês</span>
                  <span style={{ 
                    display: 'inline-block', 
                    margin: '5px', 
                    padding: '8px 15px', 
                    background: '#e0e0e0', 
                    borderRadius: '20px', 
                    cursor: 'pointer'
                  }} data-term="60">2 meses</span>
                  <span style={{ 
                    display: 'inline-block', 
                    margin: '5px', 
                    padding: '8px 15px', 
                    background: '#e0e0e0', 
                    borderRadius: '20px', 
                    cursor: 'pointer'
                  }} data-term="90">3 meses</span>
                </div>
              </div>
              
              <div style={{ marginBottom: '20px' }}>
                <label style={{ 
                  display: 'block', 
                  marginBottom: '8px', 
                  fontWeight: '600', 
                  color: '#2c3e50' 
                }}>Parcelas (máx. 8x)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                  <span style={{ 
                    display: 'inline-block', 
                    margin: '5px', 
                    padding: '8px 15px', 
                    background: '#3498db', 
                    color: 'white',
                    borderRadius: '20px', 
                    cursor: 'pointer'
                  }} data-installments="1">À vista</span>
                  <span style={{ 
                    display: 'inline-block', 
                    margin: '5px', 
                    padding: '8px 15px', 
                    background: '#e0e0e0', 
                    borderRadius: '20px', 
                    cursor: 'pointer'
                  }} data-installments="2">2x</span>
                  <span style={{ 
                    display: 'inline-block', 
                    margin: '5px', 
                    padding: '8px 15px', 
                    background: '#e0e0e0', 
                    borderRadius: '20px', 
                    cursor: 'pointer'
                  }} data-installments="3">3x</span>
                  <span style={{ 
                    display: 'inline-block', 
                    margin: '5px', 
                    padding: '8px 15px', 
                    background: '#e0e0e0', 
                    borderRadius: '20px', 
                    cursor: 'pointer'
                  }} data-installments="4">4x</span>
                </div>
              </div>
              
              <div style={{ 
                background: '#f8f9fa', 
                padding: '15px', 
                borderRadius: '8px', 
                marginBottom: '15px'
              }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  marginBottom: '10px'
                }}>
                  <span style={{ 
                    fontWeight: '600', 
                    color: '#7f8c8d'
                  }}>Valor solicitado:</span>
                  <span style={{ 
                    fontWeight: 'bold', 
                    color: '#2c3e50'
                  }}>R$ 0,00</span>
                </div>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  marginBottom: '10px'
                }}>
                  <span style={{ 
                    fontWeight: '600', 
                    color: '#7f8c8d'
                  }}>Taxa de juros:</span>
                  <span style={{ 
                    fontWeight: 'bold', 
                    color: '#2c3e50'
                  }}>1,8% ao mês</span>
                </div>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  marginBottom: '10px'
                }}>
                  <span style={{ 
                    fontWeight: '600', 
                    color: '#7f8c8d'
                  }}>Total com juros:</span>
                  <span style={{ 
                    fontWeight: 'bold', 
                    color: '#2c3e50'
                  }}>R$ 0,00</span>
                </div>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between'
                }}>
                  <span style={{ 
                    fontWeight: '600', 
                    color: '#7f8c8d'
                  }}>Valor da parcela:</span>
                  <span style={{ 
                    fontWeight: 'bold', 
                    color: '#2c3e50'
                  }}>R$ 0,00</span>
                </div>
              </div>
              
              <button type="submit" style={{ 
                background: '#2ecc71',
                color: 'white',
                border: 'none',
                padding: '12px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '600',
                width: '100%',
                transition: 'background 0.3s'
              }}>Solicitar Empréstimo</button>
            </form>
          </div>
        </div>

        <div style={{ 
          background: 'white', 
          borderRadius: '15px', 
          boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
          overflow: 'hidden',
          marginBottom: '30px'
        }}>
          <div style={{ 
            background: '#3498db', 
            color: 'white', 
            padding: '15px 20px', 
            fontSize: '1.2rem'
          }}>
            Extrato de Transações
          </div>
          <div style={{ 
            maxHeight: '400px', 
            overflowY: 'auto',
            padding: '25px'
          }}>
            {currentUser.transactions.length === 0 ? (
              <div style={{ padding: '12px', borderBottom: '1px solid #eee' }}>
                Nenhuma transação encontrada
              </div>
            ) : (
              [...currentUser.transactions].reverse().map((transaction, index) => (
                <div 
                  key={index}
                  style={{ 
                    padding: '12px', 
                    borderBottom: '1px solid #eee',
                    display: 'flex',
                    justifyContent: 'space-between'
                  }}
                >
                  <div>
                    <div style={{ 
                      fontWeight: '600', 
                      color: '#2c3e50'
                    }}>{transaction.type}</div>
                    <div>{new Date(transaction.date).toLocaleString('pt-BR')}</div>
                  </div>
                  <div style={{ 
                    color: transaction.amount >= 0 ? '#2ecc71' : '#e74c3c',
                    fontWeight: transaction.amount >= 0 ? 'bold' : 'normal'
                  }}>
                    {transaction.amount >= 0 ? '+' : ''}{formatCurrency(transaction.amount)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // Painel do Administrador
  if (screen === 'admin' && currentUser) {
    return (
      <div>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '20px',
          padding: '10px 0'
        }}>
          <h2 style={{ fontSize: '1.5rem', color: '#2c3e50' }}>Painel do Administrador</h2>
          <button 
            onClick={handleLogout}
            style={{ 
              background: '#e74c3c', 
              color: 'white', 
              border: 'none', 
              padding: '8px 15px', 
              borderRadius: '8px',
              cursor: 'pointer'
            }}>
            Sair
          </button>
        </div>

        <div style={{ 
          display: 'flex', 
          borderBottom: '2px solid #eee',
          marginBottom: '20px'
        }}>
          <div 
            onClick={() => setScreen('admin-users')}
            style={{ 
              padding: '12px 20px', 
              cursor: 'pointer', 
              fontWeight: '600',
              color: screen === 'admin-users' ? '#3498db' : '#7f8c8d',
              borderBottom: screen === 'admin-users' ? '3px solid #3498db' : 'none'
            }}>
            Usuários
          </div>
          <div 
            onClick={() => setScreen('admin-loans')}
            style={{ 
              padding: '12px 20px', 
              cursor: 'pointer', 
              fontWeight: '600',
              color: screen === 'admin-loans' ? '#3498db' : '#7f8c8d',
              borderBottom: screen === 'admin-loans' ? '3px solid #3498db' : 'none'
            }}>
            Empréstimos
          </div>
          <div 
            onClick={() => setScreen('admin-groups')}
            style={{ 
              padding: '12px 20px', 
              cursor: 'pointer', 
              fontWeight: '600',
              color: screen === 'admin-groups' ? '#3498db' : '#7f8c8d',
              borderBottom: screen === 'admin-groups' ? '3px solid #3498db' : 'none'
            }}>
            Grupos
          </div>
        </div>

        {/* Aba de Usuários */}
        {screen === 'admin-users' && (
          <div style={{ 
            background: 'white', 
            borderRadius: '15px', 
            boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
            overflow: 'hidden'
          }}>
            <div style={{ 
              background: '#3498db', 
              color: 'white', 
              padding: '15px 20px', 
              fontSize: '1.2rem'
            }}>
              Gerenciar Usuários
            </div>
            <div style={{ padding: '25px' }}>
              {users.filter(user => !user.is_admin).map(user => (
                <div key={user.id} style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  padding: '15px',
                  borderBottom: '1px solid #eee'
                }}>
                  <div>
                    <strong>{user.name}</strong><br />
                    {user.email}<br />
                    Grupo: {user.group || 'N/A'}
                  </div>
                  <div>
                    <strong>{formatCurrency(user.balance)}</strong><br />
                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                      <input 
                        type="number" 
                        id={`balance-${user.id}`} 
                        defaultValue={user.balance} 
                        step="0.01" 
                        style={{ 
                          width: '100px', 
                          padding: '5px',
                          border: '2px solid #e0e0e0',
                          borderRadius: '8px'
                        }}
                      />
                      <button 
                        onClick={() => {
                          const balanceInput = document.getElementById(`balance-${user.id}`);
                          const newBalance = parseFloat(balanceInput.value);
                          if (!isNaN(newBalance)) {
                            pb.collection('users').update(user.id, { balance: newBalance })
                              .then(() => {
                                setUsers(users.map(u => 
                                  u.id === user.id ? { ...u, balance: newBalance } : u
                                ));
                                alert(`Saldo atualizado para ${formatCurrency(newBalance)}`);
                              })
                              .catch(err => alert('Erro ao atualizar saldo: ' + err.message));
                          }
                        }}
                        style={{ 
                          background: '#2ecc71', 
                          color: 'white', 
                          border: 'none',
                          padding: '5px 10px',
                          borderRadius: '8px',
                          cursor: 'pointer'
                        }}>
                        Atualizar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Aba de Empréstimos */}
        {screen === 'admin-loans' && (
          <div style={{ 
            background: 'white', 
            borderRadius: '15px', 
            boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
            overflow: 'hidden'
          }}>
            <div style={{ 
              background: '#3498db', 
              color: 'white', 
              padding: '15px 20px', 
              fontSize: '1.2rem'
            }}>
              Solicitações de Empréstimo
            </div>
            <div style={{ padding: '25px' }}>
              {loans.map(loan => {
                const user = users.find(u => u.id === loan.user_id);
                if (!user) return null;
                
                const calculation = calculateLoan(
                  loan.amount, 
                  loan.term_in_days, 
                  loan.installments
                );
                
                return (
                  <div key={loan.id} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '15px',
                    borderBottom: '1px solid #eee'
                  }}>
                    <div>
                      <strong>{user.name}</strong><br />
                      Valor: {formatCurrency(loan.amount)}<br />
                      Prazo: {loan.term_in_days} dias ({(loan.term_in_days/30).toFixed(1)} meses)<br />
                      Parcelas: {loan.installments}x
                    </div>
                    <div>
                      <div style={{ 
                        background: '#f8f9fa', 
                        padding: '15px', 
                        borderRadius: '8px',
                        marginBottom: '10px'
                      }}>
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          padding: '8px 0',
                          borderBottom: '1px solid #eee'
                        }}>
                          <span>Valor total:</span>
                          <span>{formatCurrency(calculation.totalAmount)}</span>
                        </div>
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          padding: '8px 0',
                          borderBottom: '1px solid #eee'
                        }}>
                          <span>Juros:</span>
                          <span>{formatCurrency(calculation.interestAmount)}</span>
                        </div>
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          padding: '8px 0'
                        }}>
                          <span>Parcela:</span>
                          <span>{formatCurrency(calculation.installmentAmount)}</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleApproveLoan(loan.id)}
                        style={{ 
                          background: '#2ecc71', 
                          color: 'white', 
                          border: 'none',
                          padding: '8px 15px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          width: '100%',
                          marginBottom: '5px'
                        }}>
                        Aprovar
                      </button>
                      <button 
                        onClick={() => handleRejectLoan(loan.id)}
                        style={{ 
                          background: '#e74c3c', 
                          color: 'white', 
                          border: 'none',
                          padding: '8px 15px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          width: '100%'
                        }}>
                        Rejeitar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Aba de Grupos */}
        {screen === 'admin-groups' && (
          <div style={{ 
            background: 'white', 
            borderRadius: '15px', 
            boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
            overflow: 'hidden'
          }}>
            <div style={{ 
              background: '#3498db', 
              color: 'white', 
              padding: '15px 20px', 
              fontSize: '1.2rem'
            }}>
              Total por Grupo
            </div>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(2, 1fr)', 
              gap: '15px',
              padding: '25px'
            }}>
              {[1, 2, 3, 4].map(group => {
                const total = users
                  .filter(u => u.group === group)
                  .reduce((sum, u) => sum + u.balance, 0);
                
                return (
                  <div key={group} style={{ 
                    background: 'white', 
                    padding: '15px', 
                    borderRadius: '10px',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
                    textAlign: 'center'
                  }}>
                    <div style={{ 
                      fontWeight: '600', 
                      color: '#7f8c8d',
                      marginBottom: '8px'
                    }}>
                      Grupo {group}
                    </div>
                    <div style={{ 
                      fontSize: '1.8rem', 
                      fontWeight: 'bold', 
                      color: '#2c3e50'
                    }}>
                      {formatCurrency(total)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  return <div>Carregando...</div>;
}

export default App;
