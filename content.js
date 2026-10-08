// English Quest — контент-пак по УМК "Английский в фокусе" (Spotlight) 2/3/4 класс.
// Ссылки на модули по книгам для учителя из вложений пользователя.

// ---------- ПЕРСОНАЖИ ----------
const CHARACTERS = {
  harlow: {
    id: 'harlow',
    name: 'Dr. Harlow',
    subtitle: 'Главный гид · Олень',
    color: '#c88a4a',
    accent: '#7a4a1e',
    emoji: '🦌',
    role: 'Доктор-олень из Animal Hospital. Ведёт по всем урокам, приветствует, объясняет задание.',
    introEn: 'Hi, I am Doctor Harlow. Let us learn English.',
    introRu: null, // у Dr. Harlow — HARLOW_LINES.teamCard
  },
  luna: {
    id: 'luna',
    name: 'Nurse Luna',
    subtitle: 'Госпиталь',
    color: '#ff7bb0',
    accent: '#a83a72',
    emoji: '🐰',
    role: 'Помогает с животными и здоровьем.',
    introEn: 'I am Nurse Luna. Nice to meet you.',
    introRu: 'Привет! Я Nurse Luna. Я помогаю с животными и здоровьем — загляни в уроки про животных!',
  },
  max: {
    id: 'max',
    name: 'Miner Max',
    subtitle: 'Крафт-мир',
    color: '#3a9fe0',
    accent: '#245b85',
    emoji: '⛏️',
    role: 'Добывает блоки, знает предметы и цвета.',
    introEn: 'I am Miner Max. Nice to meet you.',
    introRu: 'Привет! Я Miner Max. Со мной ты узнаешь предметы, цвета и вещи в доме.',
  },
  owl: {
    id: 'owl',
    name: 'Prof. Owl',
    subtitle: 'Грамматика',
    color: '#a870ff',
    accent: '#5a3a99',
    emoji: '🦉',
    role: 'Учит правилам и помогает читать.',
    introEn: 'I am Prof. Owl. Nice to meet you.',
    introRu: 'Здравствуй! Я Prof. Owl. Я научу тебя правилам и помогу читать.',
  },
  robo: {
    id: 'robo',
    name: 'DJ Robo',
    subtitle: 'Произношение',
    color: '#f5c02b',
    accent: '#8a6612',
    emoji: '🤖',
    role: 'Отвечает за микрофон и звук.',
    introEn: 'I am DJ Robo. Nice to meet you.',
    introRu: 'Бип-буп! Я DJ Robo. Со мной ты будешь говорить по-английски вслух!',
  },
};

// ---------- ЭМОДЗИ ДЛЯ СЛОВ ----------
const E = {
  // people & family
  mum:'👩', mother:'👩', dad:'👨', father:'👨', brother:'👦', sister:'👧',
  grandma:'👵', grandpa:'👴', family:'👨‍👩‍👧‍👦', friend:'🧑‍🤝‍🧑', baby:'👶',
  boy:'👦', girl:'👧', teacher:'👩‍🏫', doctor:'👨‍⚕️', nurse:'👩‍⚕️', vet:'🧑‍⚕️',
  uncle:'👨', aunt:'👩', cousin:'🧒', hero:'🦸',
  // animals
  cat:'🐱', dog:'🐶', rabbit:'🐰', bird:'🐦', fish:'🐟', frog:'🐸',
  mouse:'🐭', horse:'🐴', pig:'🐷', sheep:'🐑', cow:'🐮', duck:'🦆',
  chick:'🐤', hen:'🐔', bear:'🐻', lion:'🦁', tiger:'🐯', monkey:'🐵',
  elephant:'🐘', giraffe:'🦒', crocodile:'🐊', hippo:'🦛', penguin:'🐧',
  seal:'🦭', dolphin:'🐬', snake:'🐍', spider:'🕷️', butterfly:'🦋',
  // food
  apple:'🍎', banana:'🍌', orange:'🍊', pear:'🍐', grapes:'🍇', pineapple:'🍍',
  strawberry:'🍓', watermelon:'🍉', peach:'🍑', lemon:'🍋',
  bread:'🍞', cheese:'🧀', egg:'🥚', milk:'🥛', butter:'🧈',
  cake:'🎂', chocolate:'🍫', pizza:'🍕', burger:'🍔', chips:'🍟',
  ice_cream:'🍦', biscuits:'🍪', cookie:'🍪', jelly:'🍮', sausages:'🌭',
  chicken:'🍗', potato:'🥔', tomato:'🍅', carrot:'🥕', corn:'🌽',
  rice:'🍚', pasta:'🍝', soup:'🍲', water:'💧', juice:'🧃', tea:'🍵',
  // toys & objects
  toy:'🧸', ball:'⚽', doll:'🪆', teddy_bear:'🧸', kite:'🪁', drum:'🥁',
  train:'🚂', car:'🚗', bus:'🚌', plane:'✈️', bike:'🚲', ship:'🚢',
  balloon:'🎈', present:'🎁', puzzle:'🧩', robot:'🤖', helicopter:'🚁',
  camera:'📷', phone:'📱', guitar:'🎸', piano:'🎹', violin:'🎻',
  // house
  house:'🏠', bed:'🛏️', chair:'🪑', table:'🪑', sofa:'🛋️', lamp:'💡',
  bath:'🛁', clock:'🕰️', book:'📖', pen:'🖊️', pencil:'✏️', ruler:'📏',
  bag:'🎒', desk:'📚', crayon:'🖍️', eraser:'🩹', school:'🏫', window:'🪟',
  door:'🚪', mirror:'🪞', radio:'📻', tv:'📺', computer:'💻', fridge:'🧊',
  // clothes
  hat:'🎩', tshirt:'👕', shirt:'👔', shoes:'👟', socks:'🧦', jacket:'🧥',
  skirt:'👗', trousers:'👖', jeans:'👖', dress:'👗', coat:'🧥', boots:'🥾',
  // nature
  sun:'☀️', moon:'🌙', star:'⭐', tree:'🌳', flower:'🌸', cloud:'☁️',
  rain:'🌧️', snow:'❄️', river:'🌊', mountain:'⛰️', beach:'🏖️', park:'🏞️',
  // craft
  stone:'🪨', wood:'🪵', diamond:'💎', gold:'🥇', sword:'⚔️', shield:'🛡️',
  bow:'🏹', bucket:'🪣', torch:'🔥', chest:'🧰', map:'🗺️', key:'🗝️',
  fire:'🔥', gem:'💎',
  // colors
  red:'🟥', blue:'🟦', green:'🟩', yellow:'🟨', black:'⬛', white:'⬜',
  pink:'🩷', purple:'🟪', orange_c:'🟧', brown:'🟫', grey:'⚪',
  // sports & activities
  swim:'🏊', run:'🏃', jump:'🤸', dance:'💃', sing:'🎤', read:'📖',
  write:'✍️', draw:'🎨', play:'🎮', sleep:'😴', eat:'🍽️', drink:'🥤',
  ride:'🚴', ski:'⛷️', skate:'⛸️', football:'⚽', basketball:'🏀', tennis:'🎾',
  // holidays / places
  circus:'🎪', zoo:'🦁', theatre:'🎭', museum:'🏛️', shop:'🏬', cafe:'☕',
  cinema:'🎬', castle:'🏰', hospital:'🏥', church:'⛪',
  // parts of body
  head:'🗣️', hand:'✋', foot:'🦶', eye:'👁️', ear:'👂', nose:'👃', mouth:'👄',
  hair:'💇',
  // numbers
  one:'1️⃣', two:'2️⃣', three:'3️⃣', four:'4️⃣', five:'5️⃣', six:'6️⃣',
  seven:'7️⃣', eight:'8️⃣', nine:'9️⃣', ten:'🔟',
};

// ---------- ТЕМАТИЧЕСКИЕ УРОКИ ----------
// grade: 2 | 3 | 4  — соответствует УМК Spotlight 2/3/4.
// guide: id персонажа-помощника (Dr. Harlow всегда представляет)
// words: [{en, ru, emoji}]
// phrases: короткие фразы для аудирования/произношения
// grammar: правила и упражнения "заполни пропуск"
// reading: короткие рассказы + вопросы
// intro: реплика Dr. Harlow при входе в урок

const LESSONS = [
  // ============ 2 КЛАСС ============
  {
    id:'g2-letters', grade:2, order:1, guide:'owl', module:'Starter', topics:['g2-abc'], cefr:'Pre-A1',
    title:'My Letters!', subtitle:'Алфавит и первые звуки',
    intro:'Начнём с самого начала — с английских букв. Слушай внимательно, как звучит каждая буква.',
    words:[
      {en:'apple', ru:'яблоко', emoji:'🍎'},
      {en:'bag', ru:'сумка', emoji:'🎒'},
      {en:'cat', ru:'кот', emoji:'🐱'},
      {en:'dog', ru:'собака', emoji:'🐶'},
      {en:'egg', ru:'яйцо', emoji:'🥚'},
      {en:'fish', ru:'рыба', emoji:'🐟'},
      {en:'girl', ru:'девочка', emoji:'👧'},
      {en:'hat', ru:'шляпа', emoji:'🎩'},
      {en:'ink', ru:'чернила', emoji:'🖋️'},
      {en:'jam', ru:'варенье', emoji:'🍯'},
      {en:'king', ru:'король', emoji:'🤴'},
      {en:'lion', ru:'лев', emoji:'🦁'},
    ],
    phrases:[
      'A is for apple.',
      'B is for bag.',
      'C is for cat.',
      'D is for dog.',
    ],
    grammar:[
      {q:'___ is for apple.', a:'A', hint:'Первая буква алфавита.', options:['A','B','C','D']},
      {q:'C is for ___.', a:'cat', hint:'Мяу-мяу.', options:['dog','cat','fish','bag']},
    ],
    reading:{title:'ABC Song', text:'A is for apple. B is for bag. C is for cat. D is for dog. Let\u2019s sing the ABC!', questions:[
      {q:'What is A for?', a:'apple', options:['apple','ant','arm']},
      {q:'What is D for?', a:'dog', options:['duck','dad','dog']},
    ]},
  },
  {
    id:'g2-hello', grade:2, order:2, guide:'harlow', module:'Starter', topics:['g2-greet', 'g2-friends'], cefr:'Pre-A1',
    title:'Hello!', subtitle:'Приветствие и знакомство',
    intro:'Поздороваемся по-английски. Hello — значит «привет».',
    words:[
      {en:'hello', ru:'привет', emoji:'👋'},
      {en:'goodbye', ru:'пока', emoji:'👋'},
      {en:'name', ru:'имя', emoji:'📛'},
      {en:'boy', ru:'мальчик', emoji:'👦'},
      {en:'girl', ru:'девочка', emoji:'👧'},
      {en:'friend', ru:'друг', emoji:'🧑‍🤝‍🧑'},
      {en:'teacher', ru:'учитель', emoji:'👩‍🏫'},
      {en:'student', ru:'ученик', emoji:'🧒'},
    ],
    phrases:[
      'Hello! What is your name?',
      'My name is Kostya.',
      'Nice to meet you.',
      'Goodbye! See you later.',
    ],
    grammar:[
      {q:'Hello! My ___ is Kostya.', a:'name', hint:'Как тебя зовут?', options:['name','boy','friend','hello']},
      {q:'___ to meet you.', a:'Nice', hint:'Приятно.', options:['Nice','Name','Good','Bye']},
    ],
    reading:{title:'A New Friend', text:'A boy meets a girl at school. He says, "Hello! My name is Sam." The girl says, "Hi, Sam! I am Lily. Nice to meet you!"', questions:[
      {q:'What is the boy\u2019s name?', a:'Sam', options:['Sam','Tom','Lily']},
      {q:'Where do they meet?', a:'at school', options:['at home','at school','in a shop']},
    ]},
  },
  {
    id:'g2-family', grade:2, order:3, guide:'harlow', module:'Starter', topics:['g2-family'], cefr:'Pre-A1',
    title:'My Family!', subtitle:'Семья',
    intro:'Семья — это самое важное. Давай выучим, как назвать по-английски маму, папу и других.',
    words:[
      {en:'mum', ru:'мама', emoji:'👩'},
      {en:'dad', ru:'папа', emoji:'👨'},
      {en:'brother', ru:'брат', emoji:'👦'},
      {en:'sister', ru:'сестра', emoji:'👧'},
      {en:'grandma', ru:'бабушка', emoji:'👵'},
      {en:'grandpa', ru:'дедушка', emoji:'👴'},
      {en:'baby', ru:'малыш', emoji:'👶'},
      {en:'family', ru:'семья', emoji:'👨‍👩‍👧‍👦'},
    ],
    phrases:[
      'This is my mum.',
      'This is my dad.',
      'I love my family.',
      'My brother is funny.',
    ],
    grammar:[
      {skill:'G2-01', q:'This ___ my mum.', a:'is', hint:'Единственное число, третье лицо.', options:['is','am','are','be']},
      {q:'I ___ my family.', a:'love', hint:'Люблю.', options:['love','like','have','see']},
    ],
    reading:{title:'My Family', text:'I have a big family. My mum is kind. My dad is funny. My sister is small. I love them all.', questions:[
      {q:'How is dad?', a:'funny', options:['tall','funny','sad']},
      {q:'Who is small?', a:'sister', options:['sister','brother','mum']},
    ]},
  },
  {
    id:'g2-home', grade:2, order:4, guide:'max', module:'M1', topics:['g2-family'], cefr:'Pre-A1',
    title:'My Home!', subtitle:'Мой дом и комнаты',
    intro:'Заглянем в дом. Крафт-мир начинается с уютного жилища!',
    words:[
      {en:'house', ru:'дом', emoji:'🏠'},
      {en:'bed', ru:'кровать', emoji:'🛏️'},
      {en:'chair', ru:'стул', emoji:'🪑'},
      {en:'table', ru:'стол', emoji:'🪑'},
      {en:'sofa', ru:'диван', emoji:'🛋️'},
      {en:'lamp', ru:'лампа', emoji:'💡'},
      {en:'bath', ru:'ванна', emoji:'🛁'},
      {en:'window', ru:'окно', emoji:'🪟'},
      {en:'door', ru:'дверь', emoji:'🚪'},
      {en:'clock', ru:'часы', emoji:'🕰️'},
    ],
    phrases:[
      'This is my house.',
      'I sleep in my bed.',
      'The clock is on the table.',
      'Open the door, please.',
    ],
    grammar:[
      {skill:'G2-01', q:'The lamp ___ on the table.', a:'is', hint:'Единственное число.', options:['is','are','am','be']},
      {skill:'G2-07', q:'I sleep ___ my bed.', a:'in', hint:'Предлог места «в».', options:['in','on','under','next']},
    ],
    reading:{title:'My Room', text:'This is my room. My bed is near the window. The lamp is on the table. There is a big teddy bear on my bed.', questions:[
      {q:'Where is the bed?', a:'near the window', options:['near the door','near the window','in the bath']},
      {q:'What is on the bed?', a:'a teddy bear', options:['a lamp','a book','a teddy bear']},
    ]},
  },
  {
    id:'g2-birthday', grade:2, order:5, guide:'harlow', module:'M2', topics:['g2-birthday', 'g2-food'], cefr:'Pre-A1',
    title:'My Birthday!', subtitle:'День рождения и цифры',
    intro:'Праздник! Давай выучим числа и слова о дне рождения.',
    words:[
      {en:'cake', ru:'торт', emoji:'🎂'},
      {en:'present', ru:'подарок', emoji:'🎁'},
      {en:'balloon', ru:'шарик', emoji:'🎈'},
      {en:'candle', ru:'свеча', emoji:'🕯️'},
      {en:'one', ru:'один', emoji:'1️⃣'},
      {en:'two', ru:'два', emoji:'2️⃣'},
      {en:'three', ru:'три', emoji:'3️⃣'},
      {en:'four', ru:'четыре', emoji:'4️⃣'},
      {en:'five', ru:'пять', emoji:'5️⃣'},
      {en:'six', ru:'шесть', emoji:'6️⃣'},
      {en:'seven', ru:'семь', emoji:'7️⃣'},
      {en:'eight', ru:'восемь', emoji:'8️⃣'},
      {en:'nine', ru:'девять', emoji:'9️⃣'},
      {en:'ten', ru:'десять', emoji:'🔟'},
    ],
    phrases:[
      'Happy birthday to you.',
      'How old are you? I am nine.',
      'I have a big cake.',
      'Here is your present.',
    ],
    grammar:[
      {skill:'G2-01', q:'How old ___ you?', a:'are', hint:'Ты — are.', options:['are','is','am','be']},
      {skill:'G2-01', q:'I ___ nine years old.', a:'am', hint:'Я — am.', options:['am','is','are','be']},
    ],
    reading:{title:'Happy Birthday!', text:'Today is my birthday. I am nine years old. I have a big cake with nine candles. My friends come and sing "Happy Birthday" to me.', questions:[
      {q:'How old is the boy?', a:'nine', options:['seven','eight','nine']},
      {q:'What do friends sing?', a:'Happy Birthday', options:['Hello','Happy Birthday','ABC']},
    ]},
  },
  {
    id:'g2-animals', grade:2, order:6, guide:'luna', module:'M3', topics:['g2-pet', 'g2-hobbies'], cefr:'Pre-A1',
    title:'My Animals!', subtitle:'Животные',
    intro:'Nurse Luna и Dr. Harlow приветствуют в госпитале! Познакомимся с животными.',
    words:[
      {en:'cat', ru:'кот', emoji:'🐱'},
      {en:'dog', ru:'собака', emoji:'🐶'},
      {en:'fish', ru:'рыба', emoji:'🐟'},
      {en:'bird', ru:'птица', emoji:'🐦'},
      {en:'frog', ru:'лягушка', emoji:'🐸'},
      {en:'horse', ru:'лошадь', emoji:'🐴'},
      {en:'rabbit', ru:'кролик', emoji:'🐰'},
      {en:'mouse', ru:'мышь', emoji:'🐭'},
      {en:'chick', ru:'цыплёнок', emoji:'🐤'},
      {en:'sheep', ru:'овечка', emoji:'🐑'},
      {en:'cow', ru:'корова', emoji:'🐮'},
      {en:'duck', ru:'утка', emoji:'🦆'},
    ],
    phrases:[
      'I can swim like a fish.',
      'I can jump like a frog.',
      'I can run like a horse.',
      'The cat is on the sofa.',
    ],
    grammar:[
      {q:'I can jump ___ a frog.', a:'like', hint:'«Как» кто-то.', options:['like','and','with','of']},
      {skill:'G2-01', q:'The cat ___ on the sofa.', a:'is', hint:'Одна кошка.', options:['is','are','am','be']},
    ],
    reading:{title:'My Pet', text:'I have a small dog. His name is Rex. He is brown and funny. Rex can run, jump and swim. I love my dog!', questions:[
      {q:'What colour is Rex?', a:'brown', options:['black','white','brown']},
      {q:'What can Rex do?', a:'run, jump, swim', options:['fly and sing','run, jump, swim','only sleep']},
    ]},
  },
  {
    id:'g2-toys', grade:2, order:7, guide:'max', module:'M4', topics:['g2-colors'], cefr:'Pre-A1',
    title:'My Toys!', subtitle:'Игрушки',
    intro:'Загляни в комнату игрушек! Готов крафтить весёлые слова?',
    words:[
      {en:'toy', ru:'игрушка', emoji:'🧸'},
      {en:'ball', ru:'мяч', emoji:'⚽'},
      {en:'doll', ru:'кукла', emoji:'🪆'},
      {en:'car', ru:'машинка', emoji:'🚗'},
      {en:'train', ru:'поезд', emoji:'🚂'},
      {en:'kite', ru:'воздушный змей', emoji:'🪁'},
      {en:'drum', ru:'барабан', emoji:'🥁'},
      {en:'plane', ru:'самолёт', emoji:'✈️'},
      {en:'teddy bear', ru:'мишка', emoji:'🧸'},
      {en:'puzzle', ru:'пазл', emoji:'🧩'},
    ],
    phrases:[
      'This is my toy car.',
      'I like my teddy bear.',
      'The doll is under the bed.',
      'My train is red and blue.',
    ],
    grammar:[
      {skill:'G2-01', q:'This ___ my toy car.', a:'is', hint:'Единственное число.', options:['is','are','am','be']},
      {skill:'G2-07', q:'The doll is ___ the bed.', a:'under', hint:'Под кроватью.', options:['on','in','under','next to']},
    ],
    reading:{title:'My Toy Box', text:'I have a big toy box. In my box I have a red car, a small doll and a soft teddy bear. My teddy bear is my best friend.', questions:[
      {q:'What colour is the car?', a:'red', options:['blue','red','green']},
      {q:'Who is the best friend?', a:'teddy bear', options:['doll','ball','teddy bear']},
    ]},
  },
  {
    id:'g2-holidays', grade:2, order:8, guide:'harlow', module:'M5', topics:['g2-weekend', 'g2-hometown'], cefr:'Pre-A1',
    title:'My Holidays!', subtitle:'Каникулы и одежда',
    intro:'Каникулы! Что мы надеваем и куда идём?',
    words:[
      {en:'sun', ru:'солнце', emoji:'☀️'},
      {en:'rain', ru:'дождь', emoji:'🌧️'},
      {en:'snow', ru:'снег', emoji:'❄️'},
      {en:'hat', ru:'шляпа', emoji:'🎩'},
      {en:'t-shirt', ru:'футболка', emoji:'👕'},
      {en:'shoes', ru:'ботинки', emoji:'👟'},
      {en:'socks', ru:'носки', emoji:'🧦'},
      {en:'jacket', ru:'куртка', emoji:'🧥'},
      {en:'beach', ru:'пляж', emoji:'🏖️'},
      {en:'park', ru:'парк', emoji:'🏞️'},
    ],
    phrases:[
      'It is sunny today.',
      'I wear my hat.',
      'It is snowing! Put on your jacket.',
      'Let\u2019s go to the beach.',
    ],
    grammar:[
      {skill:'G2-01', q:'It ___ sunny today.', a:'is', hint:'It — is.', options:['is','are','am','be']},
      {q:'I ___ my hat.', a:'wear', hint:'Надеваю.', options:['wear','see','have','play']},
    ],
    reading:{title:'A Sunny Day', text:'Today is a sunny day. Mum and I go to the park. I wear a t-shirt and shorts. I play with my ball and eat an ice cream.', questions:[
      {q:'Where do they go?', a:'to the park', options:['to school','to the park','to a shop']},
      {q:'What does the boy eat?', a:'an ice cream', options:['a cake','an ice cream','an apple']},
    ]},
  },
  // ============ 3 КЛАСС ============
  {
    id:'g3-school', grade:3, order:1, guide:'owl', module:'M1', topics:['g3-school'], cefr:'Pre-A1',
    title:'School Days!', subtitle:'Школа и уроки',
    intro:'Prof. Owl расскажет о школе. Ты — ученик третьего класса, самое время!',
    words:[
      {en:'school', ru:'школа', emoji:'🏫'},
      {en:'pupil', ru:'ученик', emoji:'🧒'},
      {en:'teacher', ru:'учитель', emoji:'👩‍🏫'},
      {en:'book', ru:'книга', emoji:'📖'},
      {en:'pen', ru:'ручка', emoji:'🖊️'},
      {en:'pencil', ru:'карандаш', emoji:'✏️'},
      {en:'ruler', ru:'линейка', emoji:'📏'},
      {en:'bag', ru:'сумка', emoji:'🎒'},
      {en:'desk', ru:'парта', emoji:'📚'},
      {en:'eraser', ru:'ластик', emoji:'🩹'},
      {en:'crayon', ru:'мелок', emoji:'🖍️'},
      {en:'lesson', ru:'урок', emoji:'📚'},
    ],
    phrases:[
      'Open your book, please.',
      'I have a red pen.',
      'The teacher is kind.',
      'Look at the blackboard.',
    ],
    grammar:[
      {skill:'G2-02', q:'I ___ a red pen.', a:'have', hint:'У меня есть.', options:['have','has','am','is']},
      {skill:'G2-02', q:'She ___ a big bag.', a:'has', hint:'She — has.', options:['have','has','is','are']},
    ],
    reading:{title:'At School', text:'I go to school every day. I have many friends there. My teacher is kind. In my bag I have a book, a pen and a ruler.', questions:[
      {q:'How is the teacher?', a:'kind', options:['funny','sad','kind']},
      {q:'What is in the bag?', a:'a book, a pen and a ruler', options:['a doll','a book, a pen and a ruler','only a ball']},
    ]},
  },
  {
    id:'g3-family-moments', grade:3, order:2, guide:'harlow', module:'M2', topics:['g3-family'], cefr:'Pre-A1',
    title:'Family Moments!', subtitle:'Семейные моменты',
    intro:'Расскажем о семье и близких людях. Больше слов, больше историй.',
    words:[
      {en:'mother', ru:'мама', emoji:'👩'},
      {en:'father', ru:'папа', emoji:'👨'},
      {en:'sister', ru:'сестра', emoji:'👧'},
      {en:'brother', ru:'брат', emoji:'👦'},
      {en:'grandma', ru:'бабушка', emoji:'👵'},
      {en:'grandpa', ru:'дедушка', emoji:'👴'},
      {en:'uncle', ru:'дядя', emoji:'👨'},
      {en:'aunt', ru:'тётя', emoji:'👩'},
      {en:'cousin', ru:'двоюродный брат/сестра', emoji:'🧒'},
      {en:'baby', ru:'малыш', emoji:'👶'},
    ],
    phrases:[
      'This is my mother. Her name is Anna.',
      'My grandpa is very kind.',
      'I have a big cousin.',
      'My baby brother is small.',
    ],
    grammar:[
      {skill:'G3-11', q:'This is my mother. ___ name is Anna.', a:'Her', hint:'Мама — she — her.', options:['His','Her','My','Your']},
      {skill:'G3-11', q:'This is my father. ___ name is Peter.', a:'His', hint:'Папа — he — his.', options:['Her','His','Its','Their']},
    ],
    reading:{title:'A Big Family', text:'My family is big. I have a mother, a father, one brother and two sisters. My grandma lives with us. She is very kind and she cooks tasty food.', questions:[
      {q:'How many sisters?', a:'two', options:['one','two','three']},
      {q:'Who cooks tasty food?', a:'grandma', options:['mother','grandma','sister']},
    ]},
  },
  {
    id:'g3-food', grade:3, order:3, guide:'harlow', module:'M3', topics:['g3-food'], cefr:'Pre-A1',
    title:'All the Things I Like!', subtitle:'Еда и вкусы',
    intro:'Готовим обед по-английски! Что ты любишь?',
    words:[
      {en:'bread', ru:'хлеб', emoji:'🍞'},
      {en:'butter', ru:'масло', emoji:'🧈'},
      {en:'cheese', ru:'сыр', emoji:'🧀'},
      {en:'egg', ru:'яйцо', emoji:'🥚'},
      {en:'milk', ru:'молоко', emoji:'🥛'},
      {en:'chicken', ru:'курица', emoji:'🍗'},
      {en:'pizza', ru:'пицца', emoji:'🍕'},
      {en:'sausages', ru:'сосиски', emoji:'🌭'},
      {en:'chips', ru:'чипсы', emoji:'🍟'},
      {en:'ice cream', ru:'мороженое', emoji:'🍦'},
      {en:'orange', ru:'апельсин', emoji:'🍊'},
      {en:'apple', ru:'яблоко', emoji:'🍎'},
    ],
    phrases:[
      'I like pizza very much.',
      'I don\u2019t like milk.',
      'Do you like ice cream?',
      'Yes, I do. It is tasty!',
    ],
    grammar:[
      {skill:'G3-01', q:'I ___ like milk.', a:'don\u2019t', hint:'Отрицание в 1-м лице.', options:['don\u2019t','doesn\u2019t','isn\u2019t','not']},
      {skill:'G3-01', q:'She ___ like fish.', a:'doesn\u2019t', hint:'She — doesn\u2019t.', options:['don\u2019t','doesn\u2019t','isn\u2019t','not']},
    ],
    reading:{title:'My Favourite Food', text:'I like pizza and chicken very much. For breakfast I eat an egg and drink milk. My sister does not like eggs, but she loves ice cream.', questions:[
      {q:'What does the boy eat for breakfast?', a:'an egg', options:['a pizza','an egg','a burger']},
      {q:'What does the sister love?', a:'ice cream', options:['milk','ice cream','eggs']},
    ]},
  },
  {
    id:'g3-toys3', grade:3, order:4, guide:'max', module:'M4', topics:['g3-toys'], cefr:'Pre-A1',
    title:'Come in and Play!', subtitle:'Играем: игрушки и предлоги',
    intro:'В крафт-мире всё лежит по местам. Где твой любимый мяч?',
    words:[
      {en:'ball', ru:'мяч', emoji:'⚽'},
      {en:'doll', ru:'кукла', emoji:'🪆'},
      {en:'kite', ru:'змей', emoji:'🪁'},
      {en:'plane', ru:'самолётик', emoji:'✈️'},
      {en:'boat', ru:'кораблик', emoji:'⛵'},
      {en:'robot', ru:'робот', emoji:'🤖'},
      {en:'puzzle', ru:'пазл', emoji:'🧩'},
      {en:'guitar', ru:'гитара', emoji:'🎸'},
    ],
    phrases:[
      'The ball is under the bed.',
      'The robot is on the table.',
      'The kite is in the box.',
      'Where is my plane? It is next to the bag.',
    ],
    grammar:[
      {skill:'G3-07', q:'The ball is ___ the bed.', a:'under', hint:'Под.', options:['on','under','in','next to']},
      {skill:'G3-07', q:'The robot is ___ the table.', a:'on', hint:'На.', options:['under','on','in','behind']},
    ],
    reading:{title:'My Toys', text:'My toys are everywhere! The ball is under the bed. The robot is on the desk. The doll is in the box. My cat is next to my toys — she plays too!', questions:[
      {q:'Where is the doll?', a:'in the box', options:['on the bed','in the box','under the desk']},
      {q:'Who plays with the toys?', a:'the cat', options:['the dog','the cat','a bird']},
    ]},
  },
  {
    id:'g3-animals3', grade:3, order:5, guide:'luna', module:'M5', topics:['g3-pet', 'g3-animals'], cefr:'A1',
    title:'Furry Friends!', subtitle:'Пушистые друзья и части тела',
    intro:'Nurse Luna покажет, из каких частей состоит животное!',
    words:[
      {en:'tail', ru:'хвост', emoji:'🐕'},
      {en:'nose', ru:'нос', emoji:'👃'},
      {en:'ear', ru:'ухо', emoji:'👂'},
      {en:'eye', ru:'глаз', emoji:'👁️'},
      {en:'leg', ru:'нога', emoji:'🦵'},
      {en:'head', ru:'голова', emoji:'🗣️'},
      {en:'body', ru:'тело', emoji:'🧍'},
      {en:'mouth', ru:'рот', emoji:'👄'},
      {en:'wings', ru:'крылья', emoji:'🕊️'},
    ],
    phrases:[
      'The cat has a long tail.',
      'The rabbit has big ears.',
      'The bird has small wings.',
      'How many legs? Four legs!',
    ],
    grammar:[
      {skill:'G2-02', q:'The cat ___ a long tail.', a:'has', hint:'It — has.', options:['have','has','is','are']},
      {skill:'G2-02', q:'Rabbits ___ big ears.', a:'have', hint:'Множ. число — have.', options:['have','has','is','are']},
    ],
    reading:{title:'Funny Animals', text:'A dog has four legs and a tail. A bird has two wings and a small beak. A rabbit has big ears and can jump very high. Animals are funny!', questions:[
      {q:'How many legs has a dog?', a:'four', options:['two','four','six']},
      {q:'What can a rabbit do?', a:'jump high', options:['fly','swim','jump high']},
    ]},
  },
  {
    id:'g3-home3', grade:3, order:6, guide:'max', module:'M6', topics:['g3-home'], cefr:'A1',
    title:'Home, Sweet Home!', subtitle:'Дом милый дом',
    intro:'Miner Max покажет, где в доме сокровища и предлоги места.',
    words:[
      {en:'kitchen', ru:'кухня', emoji:'🍳'},
      {en:'bedroom', ru:'спальня', emoji:'🛏️'},
      {en:'bathroom', ru:'ванная', emoji:'🛁'},
      {en:'garden', ru:'сад', emoji:'🌳'},
      {en:'fridge', ru:'холодильник', emoji:'🧊'},
      {en:'sofa', ru:'диван', emoji:'🛋️'},
      {en:'window', ru:'окно', emoji:'🪟'},
      {en:'mirror', ru:'зеркало', emoji:'🪞'},
      {en:'TV', ru:'телевизор', emoji:'📺'},
      {en:'computer', ru:'компьютер', emoji:'💻'},
    ],
    phrases:[
      'There is a sofa in the living room.',
      'There are two windows in my bedroom.',
      'The fridge is in the kitchen.',
      'My cat is under the sofa.',
    ],
    grammar:[
      {skill:'G2-08', q:'There ___ a sofa in the room.', a:'is', hint:'Единственное число — is.', options:['is','are','am','be']},
      {skill:'G2-08', q:'There ___ two windows.', a:'are', hint:'Множественное — are.', options:['is','are','am','be']},
    ],
    reading:{title:'My House', text:'My house has four rooms. In the kitchen there is a big fridge. In the bedroom there are two beds — one for me and one for my sister. My cat sleeps on the sofa.', questions:[
      {q:'How many rooms?', a:'four', options:['two','three','four']},
      {q:'Where does the cat sleep?', a:'on the sofa', options:['under the bed','on the sofa','in the fridge']},
    ]},
  },
  {
    id:'g3-dayoff', grade:3, order:7, guide:'harlow', module:'M7', topics:['g3-hobbies', 'g3-holidays'], cefr:'A1',
    title:'A Day Off!', subtitle:'Выходной и что мы делаем',
    intro:'Выходной! Что делают ребята сейчас? Present Continuous — то, что происходит прямо сейчас.',
    words:[
      {en:'run', ru:'бегать', emoji:'🏃'},
      {en:'swim', ru:'плавать', emoji:'🏊'},
      {en:'dance', ru:'танцевать', emoji:'💃'},
      {en:'sing', ru:'петь', emoji:'🎤'},
      {en:'play', ru:'играть', emoji:'🎮'},
      {en:'read', ru:'читать', emoji:'📖'},
      {en:'write', ru:'писать', emoji:'✍️'},
      {en:'draw', ru:'рисовать', emoji:'🎨'},
      {en:'ride', ru:'кататься', emoji:'🚴'},
    ],
    phrases:[
      'I am running in the park.',
      'She is singing a song.',
      'They are playing football.',
      'Look! The boy is riding a bike.',
    ],
    grammar:[
      {skill:'G3-08', q:'She ___ singing now.', a:'is', hint:'Present Continuous: is + -ing.', options:['is','are','am','be']},
      {skill:'G3-08', q:'They ___ playing football.', a:'are', hint:'They — are.', options:['is','are','am','be']},
    ],
    reading:{title:'In the Park', text:'It is Sunday. We are in the park. Tom is running with his dog. Kate is riding a bike. Mum is reading a book on the bench. It is a nice day off!', questions:[
      {q:'What is Kate doing?', a:'riding a bike', options:['running','riding a bike','reading']},
      {q:'What is mum doing?', a:'reading a book', options:['sleeping','reading a book','singing']},
    ]},
  },
  {
    id:'g3-daybyday', grade:3, order:8, guide:'owl', module:'M8', topics:['g3-myday'], cefr:'A1',
    title:'Day by Day!', subtitle:'Каждый день: время и распорядок',
    intro:'Что ты делаешь каждый день? Prof. Owl научит говорить о времени.',
    words:[
      {en:'morning', ru:'утро', emoji:'🌅'},
      {en:'evening', ru:'вечер', emoji:'🌆'},
      {en:'night', ru:'ночь', emoji:'🌃'},
      {en:'breakfast', ru:'завтрак', emoji:'🥞'},
      {en:'lunch', ru:'обед', emoji:'🍱'},
      {en:'dinner', ru:'ужин', emoji:'🍽️'},
      {en:'Monday', ru:'понедельник', emoji:'📅'},
      {en:'Friday', ru:'пятница', emoji:'📅'},
      {en:'Sunday', ru:'воскресенье', emoji:'📅'},
    ],
    phrases:[
      'I have breakfast in the morning.',
      'I go to school at eight.',
      'We have dinner at seven.',
      'On Sunday I play with my friends.',
    ],
    grammar:[
      {skill:'G3-09', q:'I get up ___ seven o\u2019clock.', a:'at', hint:'Точное время — at.', options:['on','in','at','of']},
      {skill:'G3-09', q:'I go to school ___ Monday.', a:'on', hint:'Дни недели — on.', options:['at','in','on','of']},
    ],
    reading:{title:'My Day', text:'I get up at seven o\u2019clock. I have breakfast and go to school at eight. After school I do my homework and play with my friends. In the evening I read a book. I go to bed at nine.', questions:[
      {q:'When does the boy go to school?', a:'at eight', options:['at seven','at eight','at nine']},
      {q:'What does he do in the evening?', a:'read a book', options:['play football','read a book','sleep']},
    ]},
  },
  // ============ 4 КЛАСС ============
  {
    id:'g4-family4', grade:4, order:1, guide:'harlow', module:'M1', topics:['g4-friends', 'g4-family'], cefr:'A1',
    title:'Family & Friends!', subtitle:'Друзья и внешность',
    intro:'В 4 классе мы описываем людей: рост, волосы, характер.',
    words:[
      {en:'tall', ru:'высокий', emoji:'📏'},
      {en:'short', ru:'низкий', emoji:'📐'},
      {en:'slim', ru:'стройный', emoji:'🚶'},
      {en:'fair hair', ru:'светлые волосы', emoji:'👱'},
      {en:'dark hair', ru:'тёмные волосы', emoji:'🧑‍🦱'},
      {en:'funny', ru:'смешной', emoji:'😂'},
      {en:'kind', ru:'добрый', emoji:'💗'},
      {en:'friendly', ru:'дружелюбный', emoji:'🤝'},
      {en:'uncle', ru:'дядя', emoji:'👨'},
      {en:'aunt', ru:'тётя', emoji:'👩'},
      {en:'cousin', ru:'кузен', emoji:'🧒'},
    ],
    phrases:[
      'Uncle Harry is tall and slim.',
      'He has got fair hair.',
      'She is very funny and kind.',
      'What is he like? He is friendly.',
    ],
    grammar:[
      {skill:'G2-02', q:'He ___ got fair hair.', a:'has', hint:'He/she — has got.', options:['have','has','is','are']},
      {skill:'G2-02', q:'They ___ got a big house.', a:'have', hint:'They — have got.', options:['have','has','is','are']},
    ],
    reading:{title:'My Cousin Mia', text:'Mia is my cousin. She is ten. She is tall and slim. She has got long dark hair and green eyes. Mia is very funny — she can tell great jokes!', questions:[
      {q:'How old is Mia?', a:'ten', options:['nine','ten','eleven']},
      {q:'What eyes has Mia got?', a:'green', options:['blue','brown','green']},
    ]},
  },
  {
    id:'g4-workingday', grade:4, order:2, guide:'harlow', module:'M2', topics:['g4-jobs', 'g4-routine'], cefr:'A1',
    title:'A Working Day!', subtitle:'Профессии и рабочий день',
    intro:'Кем работают люди? Узнаем самые важные профессии.',
    words:[
      {en:'doctor', ru:'доктор', emoji:'👨‍⚕️'},
      {en:'nurse', ru:'медсестра', emoji:'👩‍⚕️'},
      {en:'vet', ru:'ветеринар', emoji:'🧑‍⚕️'},
      {en:'teacher', ru:'учитель', emoji:'👩‍🏫'},
      {en:'driver', ru:'водитель', emoji:'🧑‍✈️'},
      {en:'baker', ru:'пекарь', emoji:'🧑‍🍳'},
      {en:'farmer', ru:'фермер', emoji:'🧑‍🌾'},
      {en:'postman', ru:'почтальон', emoji:'📮'},
      {en:'hospital', ru:'больница', emoji:'🏥'},
      {en:'shop', ru:'магазин', emoji:'🏬'},
    ],
    phrases:[
      'My mum is a doctor. She works in a hospital.',
      'I always help my mum.',
      'The farmer usually gets up early.',
      'What does your dad do?',
    ],
    grammar:[
      {skill:'G4-01', q:'She ___ in a hospital.', a:'works', hint:'She — глагол + s.', options:['work','works','working','are']},
      {q:'I ___ help my mum.', a:'always', hint:'Наречие частоты.', options:['always','tomorrow','now','yesterday']},
    ],
    reading:{title:'My Mum the Doctor', text:'My mum is a doctor. She works in a big hospital. Every day she helps sick people. She usually gets up at six and comes home at seven. I am proud of her!', questions:[
      {q:'What is mum?', a:'a doctor', options:['a nurse','a doctor','a teacher']},
      {q:'When does she get up?', a:'at six', options:['at five','at six','at seven']},
    ]},
  },
  {
    id:'g4-tastytreats', grade:4, order:3, guide:'harlow', module:'M3', topics:['g4-routine', 'g4-shopping'], cefr:'A1',
    title:'Tasty Treats!', subtitle:'Вкусняшки и порции',
    intro:'Ммм, вкусно! Учим how much и how many.',
    words:[
      {en:'sugar', ru:'сахар', emoji:'🍬'},
      {en:'flour', ru:'мука', emoji:'🌾'},
      {en:'butter', ru:'масло', emoji:'🧈'},
      {en:'lemon', ru:'лимон', emoji:'🍋'},
      {en:'coconut', ru:'кокос', emoji:'🥥'},
      {en:'pineapple', ru:'ананас', emoji:'🍍'},
      {en:'mango', ru:'манго', emoji:'🥭'},
      {en:'jelly', ru:'желе', emoji:'🍮'},
      {en:'biscuits', ru:'печенье', emoji:'🍪'},
      {en:'a lot of', ru:'много', emoji:'📦'},
    ],
    phrases:[
      'How much sugar do you need?',
      'How many lemons are there?',
      'I need a lot of flour.',
      'There is some milk in the fridge.',
    ],
    grammar:[
      {skill:'G4-02', q:'How ___ sugar? (нельзя посчитать)', a:'much', hint:'Неисчисляемое — much.', options:['much','many','a','some']},
      {skill:'G4-02', q:'How ___ lemons? (можно посчитать)', a:'many', hint:'Исчисляемое — many.', options:['much','many','a','some']},
    ],
    reading:{title:'Grandma\u2019s Cake', text:'My grandma makes the best cake. She needs a lot of flour, some sugar and three eggs. She also puts one lemon in the cake. It is very tasty!', questions:[
      {q:'How many eggs?', a:'three', options:['two','three','four']},
      {q:'What is in the cake?', a:'flour, sugar, eggs, lemon', options:['only sugar','flour, sugar, eggs, lemon','only lemon']},
    ]},
  },
  {
    id:'g4-zoo', grade:4, order:4, guide:'luna', module:'M4', topics:['g4-nature'], cefr:'A1',
    title:'At the Zoo!', subtitle:'В зоопарке',
    intro:'Nurse Luna берёт нас в путешествие в зоопарк! Смотри в оба.',
    words:[
      {en:'lion', ru:'лев', emoji:'🦁'},
      {en:'tiger', ru:'тигр', emoji:'🐯'},
      {en:'monkey', ru:'обезьяна', emoji:'🐵'},
      {en:'elephant', ru:'слон', emoji:'🐘'},
      {en:'giraffe', ru:'жираф', emoji:'🦒'},
      {en:'crocodile', ru:'крокодил', emoji:'🐊'},
      {en:'hippo', ru:'бегемот', emoji:'🦛'},
      {en:'penguin', ru:'пингвин', emoji:'🐧'},
      {en:'seal', ru:'тюлень', emoji:'🦭'},
      {en:'dolphin', ru:'дельфин', emoji:'🐬'},
    ],
    phrases:[
      'The lion is stronger than the tiger.',
      'The giraffe is the tallest animal.',
      'Elephants eat leaves.',
      'Look! Monkeys are jumping.',
    ],
    grammar:[
      {skill:'G4-04', q:'The lion is ___ than the cat.', a:'bigger', hint:'Сравнительная степень.', options:['big','bigger','biggest','more big']},
      {skill:'G4-04', q:'The giraffe is the ___ animal.', a:'tallest', hint:'Превосходная степень.', options:['tall','taller','tallest','more tall']},
    ],
    reading:{title:'A Day at the Zoo', text:'On Sunday we went to the zoo. We saw a big lion, two funny monkeys and a huge elephant. The giraffe was the tallest animal there. It was a great day!', questions:[
      {q:'Which animal was the tallest?', a:'giraffe', options:['lion','elephant','giraffe']},
      {q:'When did they go?', a:'on Sunday', options:['on Monday','on Sunday','on Friday']},
    ]},
  },
  {
    id:'g4-yesterday', grade:4, order:5, guide:'owl', module:'M5', topics:['g4-travel', 'g4-friends'], cefr:'A1',
    title:'Where Were You Yesterday?', subtitle:'Прошедшее время was/were',
    intro:'Where were you? Prof. Owl учит рассказывать о вчерашнем дне.',
    words:[
      {en:'yesterday', ru:'вчера', emoji:'📅'},
      {en:'ago', ru:'назад', emoji:'⏳'},
      {en:'happy', ru:'счастливый', emoji:'😊'},
      {en:'sad', ru:'грустный', emoji:'😢'},
      {en:'tired', ru:'уставший', emoji:'😴'},
      {en:'hungry', ru:'голодный', emoji:'🍽️'},
      {en:'thirsty', ru:'хочет пить', emoji:'💧'},
      {en:'bored', ru:'скучающий', emoji:'😐'},
      {en:'scared', ru:'испуганный', emoji:'😨'},
    ],
    phrases:[
      'I was at home yesterday.',
      'She was tired last night.',
      'They were at the zoo.',
      'Where were you?',
    ],
    grammar:[
      {skill:'G4-05', q:'I ___ at home yesterday.', a:'was', hint:'I / he / she / it — was.', options:['was','were','is','are']},
      {skill:'G4-05', q:'They ___ happy.', a:'were', hint:'They / we / you — were.', options:['was','were','is','are']},
    ],
    reading:{title:'Yesterday', text:'Yesterday I was at my grandma\u2019s house. My cousins were there too. We played all day. In the evening I was very tired but very happy!', questions:[
      {q:'Where was the boy?', a:'at grandma\u2019s', options:['at school','at grandma\u2019s','at the zoo']},
      {q:'How was he in the evening?', a:'tired and happy', options:['sad and bored','tired and happy','angry']},
    ]},
  },
  {
    id:'g4-tellthetale', grade:4, order:6, guide:'owl', module:'M6', topics:['g4-tale'], cefr:'A1',
    title:'Tell the Tale!', subtitle:'Сказка и прошедшее время',
    intro:'Prof. Owl рассказывает сказку. Учим правильные глаголы в прошедшем.',
    words:[
      {en:'castle', ru:'замок', emoji:'🏰'},
      {en:'princess', ru:'принцесса', emoji:'👸'},
      {en:'prince', ru:'принц', emoji:'🤴'},
      {en:'dragon', ru:'дракон', emoji:'🐉'},
      {en:'forest', ru:'лес', emoji:'🌲'},
      {en:'gold', ru:'золото', emoji:'🥇'},
      {en:'crown', ru:'корона', emoji:'👑'},
      {en:'brave', ru:'храбрый', emoji:'🦸'},
    ],
    phrases:[
      'Long, long ago there was a castle.',
      'The prince lived in the forest.',
      'The dragon jumped and roared.',
      'They lived happily ever after.',
    ],
    grammar:[
      {skill:'G4-06', q:'He ___ (jump) yesterday.', a:'jumped', hint:'Правильный глагол + -ed.', options:['jumped','jump','jumps','jumping']},
      {skill:'G4-06', q:'She ___ (play) football.', a:'played', hint:'play → played.', options:['played','play','plays','playing']},
    ],
    reading:{title:'The Brave Prince', text:'Long ago there was a brave prince. He lived in a big castle. One day a dragon came to the village. The prince fought the dragon and saved the people. Everyone was very happy!', questions:[
      {q:'Where did the prince live?', a:'in a big castle', options:['in a forest','in a big castle','in a shop']},
      {q:'What did he do?', a:'fought the dragon', options:['ran away','fought the dragon','ate a cake']},
    ]},
  },
  {
    id:'g4-daystoremember', grade:4, order:7, guide:'harlow', module:'M7', topics:['g4-family', 'g4-countries'], cefr:'A1',
    title:'Days to Remember!', subtitle:'Памятные дни',
    intro:'Рассказываем о праздниках и воспоминаниях. Неправильные глаголы!',
    words:[
      {en:'birthday', ru:'день рождения', emoji:'🎂'},
      {en:'party', ru:'вечеринка', emoji:'🎉'},
      {en:'holiday', ru:'праздник', emoji:'🎊'},
      {en:'summer', ru:'лето', emoji:'☀️'},
      {en:'winter', ru:'зима', emoji:'❄️'},
      {en:'spring', ru:'весна', emoji:'🌸'},
      {en:'autumn', ru:'осень', emoji:'🍂'},
      {en:'went', ru:'ходил (go)', emoji:'👣'},
      {en:'saw', ru:'видел (see)', emoji:'👁️'},
      {en:'had', ru:'был/имел (have)', emoji:'🎁'},
    ],
    phrases:[
      'Last summer I went to the sea.',
      'Yesterday I saw a big dog.',
      'We had a great party!',
      'It was a day to remember.',
    ],
    grammar:[
      {skill:'G4-07', q:'Yesterday I ___ to school.', a:'went', hint:'go → went.', options:['go','goed','went','gone']},
      {skill:'G4-07', q:'I ___ a big cat.', a:'saw', hint:'see → saw.', options:['see','sawed','saw','seen']},
    ],
    reading:{title:'My Best Birthday', text:'Last year on my birthday my parents took me to the zoo. I saw lions, giraffes and a big elephant. In the evening we had a big cake. It was a day to remember!', questions:[
      {q:'Where did they go?', a:'to the zoo', options:['to the park','to the zoo','to a shop']},
      {q:'What did they have in the evening?', a:'a big cake', options:['pizza','a big cake','ice cream']},
    ]},
  },
  {
    id:'g4-placestogo', grade:4, order:8, guide:'harlow', module:'M8', topics:['g4-holidays', 'g4-travel'], cefr:'A1',
    title:'Places to Go!', subtitle:'Путешествия и будущее время',
    intro:'Куда мы поедем на каникулы? Учим going to.',
    words:[
      {en:'beach', ru:'пляж', emoji:'🏖️'},
      {en:'mountain', ru:'гора', emoji:'⛰️'},
      {en:'lake', ru:'озеро', emoji:'🏞️'},
      {en:'city', ru:'город', emoji:'🏙️'},
      {en:'village', ru:'деревня', emoji:'🏡'},
      {en:'plane', ru:'самолёт', emoji:'✈️'},
      {en:'train', ru:'поезд', emoji:'🚂'},
      {en:'ship', ru:'корабль', emoji:'🚢'},
      {en:'suitcase', ru:'чемодан', emoji:'🧳'},
    ],
    phrases:[
      'I am going to visit London.',
      'We are going to fly by plane.',
      'She is going to swim in the sea.',
      'What are you going to do?',
    ],
    grammar:[
      {skill:'G4-08', q:'I ___ going to visit London.', a:'am', hint:'I — am.', options:['am','is','are','be']},
      {skill:'G4-08', q:'They ___ going to travel.', a:'are', hint:'They — are.', options:['am','is','are','be']},
    ],
    reading:{title:'Summer Plans', text:'This summer we are going to visit London. We are going to fly by plane. We are going to see Big Ben and go to a big park. I can\u2019t wait!', questions:[
      {q:'How are they going to travel?', a:'by plane', options:['by train','by plane','by ship']},
      {q:'What are they going to see?', a:'Big Ben', options:['a lion','Big Ben','a lake']},
    ]},
  },
];

// ---------- УРОВНИ / ТИТУЛЫ ----------
const MAX_LEVEL = 60;
// XP для перехода на level (n) с (n-1). Кривая: 40 + 12*n.
function xpForLevel(level){
  return 40 + 12 * level;
}
function totalXpForLevel(level){
  let s = 0;
  for (let i=1;i<=level;i++) s += xpForLevel(i);
  return s;
}
function levelFromXp(xp){
  let lvl = 0;
  while (lvl < MAX_LEVEL && xp >= totalXpForLevel(lvl+1)) lvl++;
  return lvl;
}
// Ранги: каждые 5 уровней — новый титул (12 рангов)
const RANKS = [
  {min:0,  title:'Rookie Explorer', emoji:'🌱', color:'#7dd87d'},
  {min:5,  title:'Junior Vet',      emoji:'🩺', color:'#3fb650'},
  {min:10, title:'Word Miner',      emoji:'⛏️', color:'#3a9fe0'},
  {min:15, title:'Block Builder',   emoji:'🧱', color:'#c58a3a'},
  {min:20, title:'Grammar Scout',   emoji:'🦉', color:'#a870ff'},
  {min:25, title:'Sound Hunter',    emoji:'🎤', color:'#f5c02b'},
  {min:30, title:'Story Teller',    emoji:'📖', color:'#e07b3a'},
  {min:35, title:'Diamond Reader',  emoji:'💎', color:'#3ac5e0'},
  {min:40, title:'Zoo Keeper',      emoji:'🦁', color:'#e0a13a'},
  {min:45, title:'Time Traveller',  emoji:'⏳', color:'#a597ff'},
  {min:50, title:'Quest Master',    emoji:'🏆', color:'#f5c02b'},
  {min:55, title:'English Legend',  emoji:'⭐', color:'#ff6b3a'},
];
function rankFor(level){
  let r = RANKS[0];
  for (const rk of RANKS) if (level >= rk.min) r = rk;
  return r;
}

// ---------- РЕПЛИКИ ГИДА ----------
const HARLOW_LINES = {
  welcome: [
    'Привет! Я Dr. Harlow. Пойдём учиться английскому весело.',
    'Готов к приключениям? Открой любой урок и начинай.',
    'Слушай внимательно — я говорю медленно, чтобы всё было понятно.',
  ],
  correct: [
    'Отлично! Ты молодец.',
    'Правильно! Ещё немного XP.',
    'Ты справился, супер!',
  ],
  wrong: [
    'Ничего страшного. Попробуй ещё раз.',
    'Почти! Слушай снова и подумай.',
    'Ошибки — часть учёбы. Идём дальше.',
  ],
  levelUp: [
    'Новый уровень! Ты крутой.',
    'Уровень выше! Так держать.',
    'Level up! Awesome!',
  ],
  teamCard: 'Я поведу тебя через все уроки. Нажми на любой урок ниже.',
};
// Реплика Dr. Harlow при открытии урока. Тот же текст озвучен в tts_voices.json,
// поэтому менять его нужно вместе с перезаписью: node tools/gen-voices.mjs или tools/import-voices.mjs
function lessonStartLine(lesson){ return `Урок «${lesson.title}». ${lesson.intro}`; }
// Что говорит герой при нажатии на его карточку в «Команде»
function heroIntro(ch){ return { en: ch.introEn, ru: ch.introRu || HARLOW_LINES.teamCard }; }
// Все фразы, записанные голосами героев (tts_voices.json). Порядок = номера файлов при импорте:
// 1–30 — русские реплики Dr. Harlow, 31–38 — остальные герои, 39–64 — буквы, 65+ — отдельные слова.
function voiceLines(){
  const out = harlowRussianLines().map(text => ({ speaker: 'harlow', lang: 'ru', text }));
  for (const id of ['luna', 'max', 'owl', 'robo']){
    const ch = CHARACTERS[id];
    out.push({ speaker: id, lang: 'en', text: ch.introEn }, { speaker: id, lang: 'ru', text: ch.introRu });
  }
  // 39–64 — буквы, 65 и дальше — отдельные слова (голос Dr. Harlow)
  WORD_AUDIO_LETTERS.forEach(text => out.push({ speaker: 'harlow', lang: 'en', kind: 'letter', text }));
  WORD_AUDIO_WORDS.forEach(text => out.push({ speaker: 'harlow', lang: 'en', kind: 'word', text }));
  return out;
}
// Отдельные буквы и слова из фраз «Говори», у которых нет своей записи (по нажатию на красное слово).
// Буквы — названия букв; слова — в нижнем регистре, кроме имён. Пока записи нет, звучит вся фраза медленнее.
const WORD_AUDIO_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const WORD_AUDIO_WORDS = ["a", "after", "always", "am", "and", "animal", "Anna", "are", "at", "bear", "big", "bike", "blackboard", "blue", "box", "by", "can", "cream", "day", "do", "does", "don't", "early", "ears", "eat", "elephants", "ever", "fair", "fly", "football", "for", "friends", "gets", "go", "going", "got", "great", "hair", "happily", "Harry", "has", "have", "he", "help", "her", "here", "home", "how", "ice", "in", "is", "it", "jump", "jumped", "jumping", "Kostya", "last", "later", "leaves", "legs", "lemons", "let's", "like", "lived", "living", "London", "long", "look", "lot", "love", "many", "meet", "monkeys", "much", "my", "need", "next", "nice", "of", "old", "on", "open", "playing", "please", "put", "red", "remember", "riding", "roared", "room", "running", "sea", "see", "she", "singing", "sleep", "small", "snowing", "some", "song", "stronger", "sunny", "tallest", "tasty", "teddy", "than", "the", "there", "they", "this", "to", "today", "under", "up", "usually", "very", "visit", "was", "we", "wear", "were", "what", "where", "windows", "with", "works", "yes", "you", "your", "zoo"];
// Все русские реплики Dr. Harlow, которые можно озвучить заранее
function harlowRussianLines(){
  const ru = s => /[а-яё]/i.test(s);
  return [...new Set([
    ...HARLOW_LINES.welcome, ...HARLOW_LINES.levelUp, HARLOW_LINES.teamCard,
    ...LESSONS.map(lessonStartLine),
  ].filter(ru))];
}

// ---------- КАРТА ПРОГРАММЫ (Spotlight 2–4 + ФРП) ----------
// Источник — документ «Quest: карта программы по английскому, 2–4 классы».
// Слои: base — есть в Spotlight; frp — обязательный минимум ФРП сверх учебника; ext — расширение Quest.
// Метки урока: module (Starter, M1…M8), topics (id тем ниже), cefr. Метка вопроса грамматики: skill (код навыка).
const CURRICULUM = {
  levels: {
    2: { cefr: 'Pre-A1', cambridge: 'начало Starters', words: 200, region: 'Мой мир' },
    3: { cefr: 'Pre-A1 / A1', cambridge: 'Starters', words: 350, region: 'Мой дом и окрестности' },
    4: { cefr: 'A1', cambridge: 'Starters / начало Movers', words: 500, region: 'Большой мир' },
  },
  // темы ФРП по классам; hours — часы из ФРП (вес темы: сколько квестов в локации), null — уточнить
  topics: [
    { id: 'g2-abc', grade: 2, title: 'Алфавит и звуки', section: 'Spotlight, вводный модуль', hours: null },
    { id: 'g2-greet', grade: 2, title: 'Приветствие, знакомство', section: 'Мир моего «я»', hours: 3 },
    { id: 'g2-family', grade: 2, title: 'Моя семья', section: 'Мир моего «я»', hours: 13 },
    { id: 'g2-birthday', grade: 2, title: 'Мой день рождения', section: 'Мир моего «я»', hours: 4 },
    { id: 'g2-food', grade: 2, title: 'Моя любимая еда', section: 'Мир моего «я»', hours: 5 },
    { id: 'g2-colors', grade: 2, title: 'Любимый цвет, игрушка', section: 'Мир моих увлечений', hours: 7 },
    { id: 'g2-hobbies', grade: 2, title: 'Любимые занятия', section: 'Мир моих увлечений', hours: 3 },
    { id: 'g2-pet', grade: 2, title: 'Мой питомец', section: 'Мир моих увлечений', hours: 3 },
    { id: 'g2-weekend', grade: 2, title: 'Выходной день', section: 'Мир моих увлечений', hours: 3 },
    { id: 'g2-school', grade: 2, title: 'Моя школа', section: 'Мир вокруг меня', hours: 2 },
    { id: 'g2-friends', grade: 2, title: 'Мои друзья', section: 'Мир вокруг меня', hours: 2 },
    { id: 'g2-hometown', grade: 2, title: 'Моя малая родина', section: 'Мир вокруг меня', hours: 6 },
    { id: 'g2-countries', grade: 2, title: 'Страны и столицы', section: 'Родная страна', hours: 2 },
    { id: 'g2-folklore', grade: 2, title: 'Фольклор, персонажи книг', section: 'Родная страна', hours: 6 },
    { id: 'g2-holidays', grade: 2, title: 'Праздники', section: 'Родная страна', hours: 2 },

    { id: 'g3-family', grade: 3, title: 'Моя семья', section: 'Мир моего «я»', hours: 5 },
    { id: 'g3-birthday', grade: 3, title: 'Мой день рождения', section: 'Мир моего «я»', hours: 2 },
    { id: 'g3-food', grade: 3, title: 'Моя любимая еда', section: 'Мир моего «я»', hours: 4 },
    { id: 'g3-myday', grade: 3, title: 'Мой день', section: 'Мир моего «я»', hours: 2 },
    { id: 'g3-toys', grade: 3, title: 'Любимая игрушка, игра', section: 'Мир моих увлечений', hours: 3 },
    { id: 'g3-pet', grade: 3, title: 'Мой питомец', section: 'Мир моих увлечений', hours: 2 },
    { id: 'g3-hobbies', grade: 3, title: 'Любимые занятия', section: 'Мир моих увлечений', hours: 5 },
    { id: 'g3-tale', grade: 3, title: 'Любимая сказка', section: 'Мир моих увлечений', hours: 5 },
    { id: 'g3-holidays', grade: 3, title: 'Выходной, каникулы', section: 'Мир моих увлечений', hours: 6 },
    { id: 'g3-home', grade: 3, title: 'Моя комната, дом', section: 'Мир вокруг меня', hours: 4 },
    { id: 'g3-school', grade: 3, title: 'Моя школа', section: 'Мир вокруг меня', hours: 4 },
    { id: 'g3-friends', grade: 3, title: 'Мои друзья, малая родина', section: 'Мир вокруг меня', hours: 4 },
    { id: 'g3-animals', grade: 3, title: 'Дикие и домашние животные', section: 'Мир вокруг меня', hours: 3 },
    { id: 'g3-weather', grade: 3, title: 'Погода, времена года', section: 'Мир вокруг меня', hours: 2 },
    { id: 'g3-countries', grade: 3, title: 'Страны, столицы, достопримечательности', section: 'Родная страна', hours: 6 },
    { id: 'g3-folklore', grade: 3, title: 'Фольклор, персонажи, праздники', section: 'Родная страна', hours: null },

    { id: 'g4-family', grade: 4, title: 'Семья, день рождения, подарки', section: 'Мир моего «я»', hours: null },
    { id: 'g4-routine', grade: 4, title: 'Еда, распорядок, домашние обязанности', section: 'Мир моего «я»', hours: null },
    { id: 'g4-games', grade: 4, title: 'Игры, питомец, любимые занятия', section: 'Мир моих увлечений', hours: null },
    { id: 'g4-sport', grade: 4, title: 'Спорт', section: 'Мир моих увлечений', hours: null },
    { id: 'g4-tale', grade: 4, title: 'Любимая сказка, история', section: 'Мир моих увлечений', hours: null },
    { id: 'g4-holidays', grade: 4, title: 'Выходной, каникулы', section: 'Мир моих увлечений', hours: null },
    { id: 'g4-room', grade: 4, title: 'Комната, мебель и интерьер', section: 'Мир вокруг меня', hours: null },
    { id: 'g4-school', grade: 4, title: 'Школа, любимые предметы', section: 'Мир вокруг меня', hours: null },
    { id: 'g4-friends', grade: 4, title: 'Друзья: внешность, характер', section: 'Мир вокруг меня', hours: null },
    { id: 'g4-travel', grade: 4, title: 'Малая родина, путешествия', section: 'Мир вокруг меня', hours: null },
    { id: 'g4-nature', grade: 4, title: 'Животные, погода, времена года', section: 'Мир вокруг меня', hours: null },
    { id: 'g4-shopping', grade: 4, title: 'Покупки', section: 'Мир вокруг меня', hours: null },
    { id: 'g4-countries', grade: 4, title: 'Страны, достопримечательности, праздники', section: 'Родная страна', hours: null },
    { id: 'g4-jobs', grade: 4, title: 'Профессии', section: 'сквозная', hours: null },
  ],
  // грамматические навыки: ошибка записывается с кодом навыка; навыки слоя frp до Spotlight — только на узнавание
  skills: [
    { code: 'G2-01', grade: 2, title: 'to be: am / is / are', where: 'вводный модуль', layer: 'base', error: 'I is, They is' },
    { code: 'G2-02', grade: 2, title: 'have got / has got', where: 'M4', layer: 'base', error: 'He have got' },
    { code: 'G2-03', grade: 2, title: 'can / can’t + глагол', where: 'M3', layer: 'base', error: 'He can swims' },
    { code: 'G2-04', grade: 2, title: 'Множественное число по правилу', where: '', layer: 'base', error: 'two cat' },
    { code: 'G2-05', grade: 2, title: 'Повелительное наклонение, Don’t', where: '', layer: 'base', error: 'Not sit down!' },
    { code: 'G2-06', grade: 2, title: 'my / your / our, this', where: '', layer: 'base', error: 'It’s me book' },
    { code: 'G2-07', grade: 2, title: 'Предлоги in / on / under', where: 'M1', layer: 'base', error: 'путаница in / on' },
    { code: 'G2-08', grade: 2, title: 'there is / there are', where: '', layer: 'frp', error: 'There is two cats' },
    { code: 'G2-09', grade: 2, title: 'I like / he likes', where: '', layer: 'frp', error: 'She like milk' },
    { code: 'G3-01', grade: 3, title: 'Present Simple: -s в 3-м лице, do / does', where: 'M3, M8', layer: 'base', error: 'Does he likes?' },
    { code: 'G3-02', grade: 3, title: 'some / any', where: 'M3', layer: 'base', error: 'I haven’t got some' },
    { code: 'G3-03', grade: 3, title: 'a / an', where: 'M4', layer: 'base', error: 'a apple' },
    { code: 'G3-04', grade: 3, title: 'this / that / these / those', where: 'M4', layer: 'base', error: 'this books' },
    { code: 'G3-05', grade: 3, title: 'Притяжательный падеж ’s', where: 'M4', layer: 'base', error: 'the book of Ann' },
    { code: 'G3-06', grade: 3, title: 'Исключения множественного числа', where: 'M5', layer: 'base', error: 'mouses, childs' },
    { code: 'G3-07', grade: 3, title: 'Предлоги места, правописание -es', where: 'M6', layer: 'base', error: 'boxs' },
    { code: 'G3-08', grade: 3, title: 'Present Continuous', where: 'M7', layer: 'base', error: 'He playing' },
    { code: 'G3-09', grade: 3, title: 'Время по часам, дни недели', where: 'M8', layer: 'base', error: 'at Monday' },
    { code: 'G3-10', grade: 3, title: 'Past Simple — узнавание', where: '', layer: 'frp', error: 'не узнаёт went как go' },
    { code: 'G3-11', grade: 3, title: 'Притяжательные местоимения his / her / its / their', where: 'M2', layer: 'base', error: 'his вместо her' },
    { code: 'G4-01', grade: 4, title: 'Present Simple или Continuous', where: 'M1–M2', layer: 'base', error: 'He is play every day' },
    { code: 'G4-02', grade: 4, title: 'much / many / a lot of', where: 'M3', layer: 'base', error: 'many milk' },
    { code: 'G4-03', grade: 4, title: 'must / mustn’t', where: 'M3', layer: 'base', error: 'You must to go' },
    { code: 'G4-04', grade: 4, title: 'Степени сравнения', where: 'M4', layer: 'base', error: 'more big, gooder' },
    { code: 'G4-05', grade: 4, title: 'was / were, порядковые числа', where: 'M5', layer: 'base', error: 'They was' },
    { code: 'G4-06', grade: 4, title: 'Past Simple правильных глаголов, did', where: 'M6', layer: 'base', error: 'Did you played?' },
    { code: 'G4-07', grade: 4, title: 'Неправильные глаголы', where: 'M7', layer: 'base', error: 'goed' },
    { code: 'G4-08', grade: 4, title: 'be going to, will / won’t', where: 'M8', layer: 'base', error: 'I going to' },
    { code: 'G4-09', grade: 4, title: 'have to', where: '', layer: 'frp', error: 'He have to' },
  ],
  // типы заданий: код → описание и редкость квеста; kinds — какие упражнения Quest уже им соответствуют
  taskTypes: [
    { code: '2-A', grade: 2, title: 'Услышал слово → выбрал картинку', rarity: 'common', kinds: ['listen'] },
    { code: '2-B', grade: 2, title: 'Буква или звук → слово', rarity: 'rare', kinds: [] },
    { code: '2-C', grade: 2, title: 'Собрать слово из букв', rarity: 'rare', kinds: ['spell'] },
    { code: '2-D', grade: 2, title: 'Найди лишнее в тематическом ряду', rarity: 'common', kinds: [] },
    { code: '2-E', grade: 2, title: 'Картинка → выбор из двух фраз', rarity: 'epic', kinds: [] },
    { code: '3-A', grade: 3, title: 'Вставить слово в короткую фразу', rarity: 'common', kinds: ['grammar'] },
    { code: '3-B', grade: 3, title: 'Сопоставить вопрос и ответ', rarity: 'rare', kinds: [] },
    { code: '3-C', grade: 3, title: 'Короткий диалог с выбором реплики', rarity: 'epic', kinds: [] },
    { code: '3-D', grade: 3, title: 'Картинка → выбор предложения', rarity: 'common', kinds: [] },
    { code: '3-E', grade: 3, title: 'Подпись к картинке из готовых слов', rarity: 'rare', kinds: [] },
    { code: '3-F', grade: 3, title: 'Мини-сказка с вопросами', rarity: 'epic', kinds: ['reading'] },
    { code: '4-A', grade: 4, title: 'Текст до 160 слов + вопросы', rarity: 'rare', kinds: ['reading'] },
    { code: '4-B', grade: 4, title: 'Верно / неверно / не сказано', rarity: 'common', kinds: [] },
    { code: '4-C', grade: 4, title: 'Собрать предложение из слов', rarity: 'common', kinds: [] },
    { code: '4-D', grade: 4, title: 'Прочитать таблицу и ответить', rarity: 'rare', kinds: [] },
    { code: '4-E', grade: 4, title: 'Написать слово или фразу самостоятельно', rarity: 'epic', kinds: [] },
    { code: '4-F', grade: 4, title: 'Дописать письмо другу по образцу', rarity: 'legendary', kinds: [] },
  ],
};
const SKILLS = Object.fromEntries(CURRICULUM.skills.map(s => [s.code, s]));
// Код типа задания для упражнения Quest в уроке этого класса (или null, если в карте такого нет)
function taskTypeFor(kind, grade){
  return CURRICULUM.taskTypes.find(t => t.grade === grade && t.kinds.includes(kind))?.code || null;
}

// экспорт в глобальную область
window.EQ = {
  CHARACTERS,
  LESSONS,
  MAX_LEVEL, xpForLevel, totalXpForLevel, levelFromXp,
  RANKS, rankFor,
  HARLOW_LINES, lessonStartLine, harlowRussianLines, heroIntro, voiceLines,
  CURRICULUM, SKILLS, taskTypeFor, EMOJI: E,
};
