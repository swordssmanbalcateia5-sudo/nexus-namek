import {dailyCycle,weeklyCycle,ARENA_SHOP,GOLD_SHOP} from './community-rules.js';
import {createDuel,finishDuel,bossKits} from './duel.js';
import { Combate, affinity } from './engine.js';

export const AREAS = [
  { id:'entrada', name:'Costa de Namek', description:'Patrulhas do império rondam o litoral.', levels:[1,3], unlock:1, enemy:'Soldado da Tropa Freeza', base:[150,18,9,9], color:'Roxo' },
  { id:'meio', name:'Planícies Verdes', description:'O terreno aberto favorece as tropas de elite.', levels:[4,6], unlock:4, enemy:'Veterano da Tropa Freeza', base:[220,23,12,12], color:'Amarelo' },
  { id:'final', name:'Base de Freeza', description:'Vença 15 encontros nesta área para liberar Freeza.', levels:[7,10], unlock:7, enemy:'Oficial da Tropa Freeza', base:[300,28,14,14], color:'Vermelho' },
];
export const BOSS = {name:'Freeza · Forma Final',base:[520,38,18,18], color:'Roxo'};
export const WORLDS = [
  {
    name:"Namek", universe:"Dragon Ball",
    areas:AREAS,
    elite:{"name": "Capitão Ginyu", "level": 11, "base": [380, 33, 16, 16]},
    boss:{"name": "Freeza · forma final", "arenaKind": "boss_freeza", "level": 12, "base": [520, 38, 18, 18], "kind": "freeza-boss", "color": "Roxo"},
  },
  {
    name:"Arlong Park", universe:"One Piece",
    areas:[
      {"name": "Costa de Cocoyasi", "enemy": "Vigia dos Piratas Arlong", "levels": [11, 13], "unlock": 1, "base": [150, 18, 9, 9], "color": "Amarelo", "description": "Vigia dos Piratas Arlong"},
      {"name": "Vila de Cocoyasi", "enemy": "Homem-peixe dos Piratas Arlong", "levels": [14, 16], "unlock": 14, "base": [220, 23, 12, 12], "color": "Vermelho", "description": "Homem-peixe dos Piratas Arlong"},
      {"name": "Fortaleza de Arlong", "enemy": "Veterano dos Piratas Arlong", "levels": [17, 20], "unlock": 17, "base": [300, 28, 14, 14], "color": "Azul", "description": "Veterano dos Piratas Arlong"}
    ],
    elite:{"name": "Kuroobi", "level": 21, "base": [385, 33, 16, 16]},
    boss:{"name": "Arlong", "arenaKind": "boss_arlong", "level": 22, "base": [532, 38, 18, 18], "kind": "rush", "color": "Azul"},
  },
  {
    name:"Exames Chūnin", universe:"Naruto",
    areas:[
      {"name": "Portões da Folha", "enemy": "Genin rival", "levels": [21, 23], "unlock": 1, "base": [150, 18, 9, 9], "color": "Vermelho", "description": "Genin rival"},
      {"name": "Floresta da Morte", "enemy": "Genin da Vila do Som", "levels": [24, 26], "unlock": 24, "base": [220, 23, 12, 12], "color": "Azul", "description": "Genin da Vila do Som"},
      {"name": "Arena dos Exames", "enemy": "Genin da Vila da Areia", "levels": [27, 30], "unlock": 27, "base": [300, 28, 14, 14], "color": "Verde", "description": "Genin da Vila da Areia"}
    ],
    elite:{"name": "Neji Hyūga", "level": 31, "base": [390, 33, 16, 16]},
    boss:{"name": "Gaara · transformação parcial", "arenaKind": "boss_gaara", "level": 32, "base": [544, 38, 18, 18], "kind": "ward", "color": "Laranja"},
  },
  {
    name:"Soul Society", universe:"Bleach",
    areas:[
      {"name": "Rukongai", "enemy": "Shinigami em patrulha", "levels": [31, 33], "unlock": 1, "base": [150, 18, 9, 9], "color": "Azul", "description": "Shinigami em patrulha"},
      {"name": "Muralhas do Seireitei", "enemy": "Soldado da guarda do Seireitei", "levels": [34, 36], "unlock": 34, "base": [220, 23, 12, 12], "color": "Verde", "description": "Soldado da guarda do Seireitei"},
      {"name": "Colina de Sōkyoku", "enemy": "Oficial de esquadrão", "levels": [37, 40], "unlock": 37, "base": [300, 28, 14, 14], "color": "Turquesa", "description": "Oficial de esquadrão"}
    ],
    elite:{"name": "Renji Abarai", "level": 41, "base": [395, 33, 16, 16]},
    boss:{"name": "Byakuya Kuchiki", "arenaKind": "boss_byakuya", "level": 42, "base": [556, 38, 18, 18], "kind": "beam", "color": "Rosa"},
  },
  {
    name:"Jujutsu Kaisen", universe:"Jujutsu Kaisen",
    areas:[
      {"name": "Escola de Jujutsu", "enemy": "Maldição menor", "levels": [41, 43], "unlock": 1, "base": [150, 18, 9, 9], "color": "Verde", "description": "Maldição menor"},
      {"name": "Distrito amaldiçoado", "enemy": "Maldição de distrito", "levels": [44, 46], "unlock": 44, "base": [220, 23, 12, 12], "color": "Turquesa", "description": "Maldição de distrito"},
      {"name": "Domínio vulcânico", "enemy": "Maldição de grau 2", "levels": [47, 50], "unlock": 47, "base": [300, 28, 14, 14], "color": "Rosa", "description": "Maldição de grau 2"}
    ],
    elite:{"name": "Portador de Dedo", "level": 51, "base": [400, 33, 16, 16]},
    boss:{"name": "Jogo", "level": 52, "base": [568, 38, 18, 18], "kind": "ginyu", "color": "Vermelho"},
  },
  {
    name:"Black Clover", universe:"Black Clover",
    areas:[
      {"name": "Vila de Hage", "enemy": "Recruta do Olho do Sol da Meia-Noite", "levels": [51, 53], "unlock": 1, "base": [150, 18, 9, 9], "color": "Turquesa", "description": "Recruta do Olho do Sol da Meia-Noite"},
      {"name": "Floresta encantada", "enemy": "Mago do Olho do Sol da Meia-Noite", "levels": [54, 56], "unlock": 54, "base": [220, 23, 12, 12], "color": "Rosa", "description": "Mago do Olho do Sol da Meia-Noite"},
      {"name": "Templo submerso", "enemy": "Veterano do Olho do Sol da Meia-Noite", "levels": [57, 60], "unlock": 57, "base": [300, 28, 14, 14], "color": "Laranja", "description": "Veterano do Olho do Sol da Meia-Noite"}
    ],
    elite:{"name": "Fana", "level": 61, "base": [405, 33, 16, 16]},
    boss:{"name": "Vetto", "level": 62, "base": [580, 38, 18, 18], "kind": "rush", "color": "Verde"},
  },
  {
    name:"Nanatsu no Taizai", universe:"Nanatsu no Taizai",
    areas:[
      {"name": "Arredores de Liones", "enemy": "Recruta de Liones", "levels": [61, 63], "unlock": 1, "base": [150, 18, 9, 9], "color": "Rosa", "description": "Recruta de Liones"},
      {"name": "Cidade de Liones", "enemy": "Cavaleiro de Liones", "levels": [64, 66], "unlock": 64, "base": [220, 23, 12, 12], "color": "Laranja", "description": "Cavaleiro de Liones"},
      {"name": "Castelo real", "enemy": "Cavaleiro Sagrado", "levels": [67, 70], "unlock": 67, "base": [300, 28, 14, 14], "color": "Roxo", "description": "Cavaleiro Sagrado"}
    ],
    elite:{"name": "Dreyfus", "level": 71, "base": [410, 33, 16, 16]},
    boss:{"name": "Hendrickson · forma demoníaca", "level": 72, "base": [592, 38, 18, 18], "kind": "beam", "color": "Preto"},
  },
  {
    name:"JoJo", universe:"JoJo",
    areas:[
      {"name": "Ruas do Cairo", "enemy": "Capanga de DIO", "levels": [71, 73], "unlock": 1, "base": [150, 18, 9, 9], "color": "Laranja", "description": "Capanga de DIO"},
      {"name": "Distrito antigo", "enemy": "Usuário de Stand a serviço de DIO", "levels": [74, 76], "unlock": 74, "base": [220, 23, 12, 12], "color": "Roxo", "description": "Usuário de Stand a serviço de DIO"},
      {"name": "Mansão de DIO", "enemy": "Usuário de Stand veterano", "levels": [77, 80], "unlock": 77, "base": [300, 28, 14, 14], "color": "Amarelo", "description": "Usuário de Stand veterano"}
    ],
    elite:{"name": "Vanilla Ice", "level": 81, "base": [415, 33, 16, 16]},
    boss:{"name": "DIO · The World", "level": 82, "base": [604, 38, 18, 18], "kind": "rush", "color": "Amarelo"},
  },
  {
    name:"Hunter × Hunter", universe:"Hunter × Hunter",
    areas:[
      {"name": "Fronteira de NGL", "enemy": "Formiga Quimera operária", "levels": [81, 83], "unlock": 1, "base": [150, 18, 9, 9], "color": "Roxo", "description": "Formiga Quimera operária"},
      {"name": "Território das formigas", "enemy": "Formiga Quimera soldado", "levels": [84, 86], "unlock": 84, "base": [220, 23, 12, 12], "color": "Amarelo", "description": "Formiga Quimera soldado"},
      {"name": "Palácio Real", "enemy": "Formiga Quimera capitã", "levels": [87, 90], "unlock": 87, "base": [300, 28, 14, 14], "color": "Vermelho", "description": "Formiga Quimera capitã"}
    ],
    elite:{"name": "Neferpitou", "level": 91, "base": [420, 33, 16, 16]},
    boss:{"name": "Meruem", "level": 92, "base": [616, 38, 18, 18], "kind": "rush", "color": "Verde"},
  },
  {
    name:"One Punch Man", universe:"One Punch Man",
    areas:[
      {"name": "Periferia da Cidade Z", "enemy": "Monstro nível Lobo", "levels": [91, 93], "unlock": 1, "base": [150, 18, 9, 9], "color": "Amarelo", "description": "Monstro nível Lobo"},
      {"name": "Zona evacuada", "enemy": "Monstro nível Tigre", "levels": [94, 96], "unlock": 94, "base": [220, 23, 12, 12], "color": "Vermelho", "description": "Monstro nível Tigre"},
      {"name": "Covil dos monstros", "enemy": "Monstro nível Demônio", "levels": [97, 100], "unlock": 97, "base": [300, 28, 14, 14], "color": "Azul", "description": "Monstro nível Demônio"}
    ],
    elite:{"name": "Rei do Mar Profundo", "level": 101, "base": [425, 33, 16, 16]},
    boss:{"name": "Boros", "level": 102, "base": [628, 38, 18, 18], "kind": "freeza-boss", "color": "Vermelho"},
  }
];
export const worldOf = state=>WORLDS[state.world??0];
export const levelCap = state=>10*(1+(state.unlocked??0));
export const COLORS = {Verde:'#71dd9f',Laranja:'#ffab68',Amarelo:'#f5d66c',Azul:'#83baff',Branco:'#ecebff',Roxo:'#cc95ff',Rosa:'#f592bc',Preto:'#a8a2be',Vermelho:'#ff8290',Turquesa:'#70e1da',Dourado:'#ffe28a'};
export const TIERS = ['Comum','Incomum','Rara','Épica','Mítica','Divina','Secreta','Transcendente'];
// PV, ataque, magia, defesa, resistência e velocidade no nível 1, antes da função.
// Degrau de +22% a +30% por raridade, garantindo Tier N Normal < Tier N Shiny (+12%) < Tier N+1 Normal.
const baseStats = [
  [100, 20, 20, 12, 12, 100],
  [122, 24, 24, 15, 15, 102],
  [150, 30, 30, 18, 18, 104],
  [185, 37, 37, 22, 22, 106],
  [230, 46, 46, 28, 28, 109],
  [290, 58, 58, 35, 35, 112],
  [370, 74, 74, 44, 44, 116],
  [480, 96, 96, 58, 58, 120]
];
const roles = {Combatente:[.10,.25,-.15,0,0,0],Guardião:[.25,-.10,0,.25,.15,0],Mágico:[-.15,0,.30,0,.10,0],Suporte:[0,-.15,.15,0,.15,.05]};
const roster = [
  ["hoova-shisui","Hoova · Shisui Uchiha",6,"Verde","Mágico","koto","Kotoamatsukami",["Verde",{magic:15,speed:8}],"ap-hoova-shisui","Naruto"],
  ["zawa-cheon","Zawa · Cheon Yeo Woon",7,"Roxo","Combatente","demonSword","Espada do Demônio Celestial",["Roxo",{attack:20,speed:8}],"ap-zawa-cheon","Nano Machine"],
  ["careca-kumagawa","Careca · Kumagawa Misogi",8,"Preto","Suporte","fiction","All Fiction",["Equipe",{magic:18,resistance:10}],"ap-careca-kumagawa","Medaka Box"],
  ["shinra_banshoman", "Shinra Banshōman", 8, "Dourado", "Combatente", "reescrita", "Reescrita da Realidade", ["Equipe", {"hp": 12, "attack": 14}], "fighter", "Fire Force"],
  ["benimaru_shinmon", "Benimaru Shinmon", 7, "Vermelho", "Combatente", "nichirin", "Nichirin", ["Fire Force", {"attack": 20, "magic": 8}], "fighter", "Fire Force"],
  ["luminous", "Luminous Valentine", 7, "Rosa", "Suporte", "ciclo_vital", "Ciclo de Vida e Morte", ["Equipe", {"hp": 12, "resistance": 6}], "support", "Tensei Shitara Slime Datta Ken"],
  ["veldora", "Veldora Tempest", 7, "Turquesa", "Mágico", "tempestade", "Tempestade do Dragão", ["Turquesa", {"magic": 22, "speed": 8}], "freeza", "Tensei Shitara Slime Datta Ken"],

  ["mayuri", "Mayuri Kurotsuchi", 5, "Roxo", "Mágico", "ashisogi", "Ashisogi Jizō", ["Mágico", {"magic": 15}], "support", "Bleach"],
  ["starrk", "Coyote Starrk", 6, "Azul", "Mágico", "metralleta", "Cero Metralleta", ["Mágico", {"magic": 13, "speed": 6}], "fighter", "Bleach"],
  ["yoruichi", "Yoruichi Shihōin", 5, "Amarelo", "Combatente", "shunko", "Shunkō", ["Combatente", {"attack": 10, "speed": 8}], "fighter", "Bleach"],
  ["urahara", "Kisuke Urahara", 6, "Verde", "Suporte", "benihime", "Benihime · Escudo de Sangue", ["Suporte", {"magic": 17, "resistance": 10}], "support", "Bleach"],
  ["shinra", "Shinra Kusakabe", 4, "Vermelho", "Combatente", "rush", "Chute de Ignição", ["Vermelho", {"attack": 12}], "fighter", "Fire Force"],
  ["arthur", "Arthur Boyle", 4, "Azul", "Combatente", "excalibur", "Excalibur", ["Azul", {"attack": 12}], "fighter", "Fire Force"],
  ["maki_oze", "Maki Oze", 3, "Laranja", "Guardião", "ward", "Guarda das Chamas", ["Laranja", {"hp": 10}], "namek", "Fire Force"],
  ["iris", "Iris", 2, "Branco", "Suporte", "heal", "Prece da Companhia 8", ["Branco", {"hp": 10}], "support", "Fire Force"],
  ["piccolo", "Piccolo", 4, "Verde", "Guardião", "piccolo", "Proteção Namekuseijin", ["Dragon Ball", {"defense": 12, "resistance": 12}], "namek"],
  ["yamcha", "Yamcha", 1, "Laranja", "Combatente", "yamcha", "Punho do Lobo", ["Combatente", {"attack": 8}], "fighter"],
  ["kuririn", "Kuririn", 2, "Amarelo", "Mágico", "kuririn", "Disco Cortante", ["Amarelo", {"magic": 10}], "monk"],
  ["bulma", "Bulma", 1, "Azul", "Suporte", "bulma", "Cápsula de Proteção", ["Azul", {"hp": 8}], "support"],
  ["tenshinhan", "Tenshinhan", 3, "Branco", "Suporte", "ward", "Taiyōken", ["Branco", {"speed": 10}], "monk"],
  ["gohan", "Gohan · Namek", 4, "Amarelo", "Combatente", "rush", "Explosão de Raiva", ["Amarelo", {"attack": 10}], "fighter"],
  ["freeza", "Freeza · Forma Final", 5, "Roxo", "Mágico", "death_ray", "Raio da Morte", ["Roxo", {"magic": 17}], "freeza"],
  ["android17", "Android 17", 6, "Verde", "Guardião", "barreira", "Barreira Contínua", ["Equipe", {"defense": 10, "resistance": 10}], "fighter"],
  ["vegeta", "Vegeta · Blue", 7, "Azul", "Combatente", "final_flash", "Final Flash", ["Dragon Ball", {"attack": 18, "magic": 8}], "fighter"],
  ["broly", "Broly · Super", 7, "Verde", "Combatente", "furia", "Fúria Crescente", ["Combatente", {"attack": 18, "hp": 8}], "namek"],
  ["goku", "Goku · Instinto Superior", 8, "Branco", "Combatente", "instinto", "Resposta Instintiva", ["Equipe", {"attack": 14, "speed": 8}], "fighter"],
  ["beerus", "Beerus", 8, "Roxo", "Mágico", "beerus", "Hakai", ["Mágico", {"magic": 22}], "freeza"],
  ["usopp", "Usopp", 1, "Amarelo", "Suporte", "heal", "Estilingue", ["Amarelo", {"hp": 8}], "support", "One Piece"],
  ["nami", "Nami", 2, "Turquesa", "Mágico", "beam", "Nuvem de Tempestade", ["Turquesa", {"magic": 10}], "support", "One Piece"],
  ["rocklee", "Rock Lee", 3, "Verde", "Combatente", "rush", "Lótus Primária", ["Verde", {"speed": 10}], "fighter", "Naruto"],
  ["zoro", "Zoro", 4, "Verde", "Combatente", "rush", "Santōryū", ["Verde", {"attack": 12}], "fighter", "One Piece"],
  ["law", "Trafalgar Law", 5, "Azul", "Suporte", "room", "ROOM", ["Equipe", {"hp": 8, "magic": 8}], "support", "One Piece"],
  ["gojo", "Gojo", 8, "Azul", "Mágico", "dominio", "Vazio Ilimitado", ["Equipe", {"magic": 15, "resistance": 8}], "fighter", "Jujutsu Kaisen"],
  ["netero", "Netero", 6, "Dourado", "Combatente", "bodisatva", "Mãos do Bodisatva", ["Combatente", {"attack": 12, "speed": 8}], "monk", "Hunter × Hunter"],
  ["mob", "Mob · ???%", 7, "Preto", "Mágico", "despertar", "Despertar Psíquico", ["Mágico", {"hp": 12, "magic": 16}], "support", "Mob Psycho 100"],
  ["accelerator", "Accelerator", 8, "Branco", "Guardião", "accelerator", "Controle Vetorial", ["Guardião", {"defense": 20, "resistance": 20}], "fighter", "Toaru"],
  ["sukuna-forma-original", "Sukuna · forma original", 8, "Vermelho", "Mágico", "beam", "Santuário Malevolente", ["Mágico", {"magic": 8}], "ap-sukuna-forma-original", "Jujutsu Kaisen"],
  ["nanami", "Nanami", 4, "Amarelo", "Combatente", "rush", "Proporção 7:3", ["Combatente", {"attack": 8}], "ap-nanami", "Jujutsu Kaisen"],
  ["maki-desperta", "Maki · desperta", 5, "Verde", "Combatente", "rush", "Corte da Alma", ["Combatente", {"attack": 8}], "ap-maki-desperta", "Jujutsu Kaisen"],
  ["aoi-todo", "Aoi Todo", 4, "Turquesa", "Suporte", "ward", "Boogie Woogie", ["Suporte", {"hp": 8}], "ap-aoi-todo", "Jujutsu Kaisen"],
  ["kasumi-miwa", "Kasumi Miwa", 1, "Azul", "Guardião", "ward", "Domínio Simples", ["Azul", {"resistance": 8}], "ap-kasumi-miwa", "Jujutsu Kaisen"],
  ["kenjaku", "Kenjaku", 6, "Roxo", "Mágico", "beam", "Espíritos em Cadeia", ["Mágico", {"magic": 8}], "ap-kenjaku", "Jujutsu Kaisen"],
  ["nobara", "Nobara", 3, "Rosa", "Mágico", "beam", "Ressonância", ["Mágico", {"magic": 8}], "ap-nobara", "Jujutsu Kaisen"],
  ["mahoraga", "Mahoraga", 6, "Branco", "Guardião", "ward", "Roda da Adaptação", ["Guardião", {"defense": 8}], "ap-mahoraga", "Jujutsu Kaisen"],
  ["yuta", "Yuta", 6, "Branco", "Mágico", "beam", "Rika", ["Mágico", {"magic": 8}], "ap-yuta", "Jujutsu Kaisen"],
  ["panda", "Panda", 2, "Branco", "Guardião", "ward", "Modo Gorila", ["Guardião", {"hp": 10}], "ap-panda", "Jujutsu Kaisen"],
  ["toji", "Toji", 5, "Preto", "Combatente", "rush", "Lança Invertida", ["Combatente", {"attack": 8}], "ap-toji", "Jujutsu Kaisen"],
  ["yamamoto", "Yamamoto", 7, "Vermelho", "Mágico", "beam", "Zanka no Tachi", ["Mágico", {"magic": 8}], "ap-yamamoto", "Bleach"],
  ["renji", "Renji", 3, "Vermelho", "Combatente", "rush", "Zabimaru", ["Combatente", {"attack": 8}], "ap-renji", "Bleach"],
  ["ikkaku", "Ikkaku", 2, "Vermelho", "Combatente", "rush", "Hōzukimaru", ["Vermelho", {"attack": 10}], "ap-ikkaku", "Bleach"],
  ["orihime", "Orihime", 3, "Laranja", "Suporte", "heal", "Escudo Triplo", ["Laranja", {"hp": 10}], "ap-orihime", "Bleach"],
  ["grimmjow", "Grimmjow", 4, "Turquesa", "Combatente", "rush", "Garra de Pantera", ["Combatente", {"attack": 8}], "ap-grimmjow", "Bleach"],
  ["uryu-thousand-year-blood-war", "Uryū · Thousand-Year Blood War", 6, "Azul", "Mágico", "beam", "Antítese", ["Mágico", {"magic": 8}], "ap-uryu-thousand-year-blood-war", "Bleach"],
  ["aizen-hogyoku", "Aizen · Hōgyoku", 7, "Roxo", "Suporte", "ward", "Hipnose Completa", ["Suporte", {"hp": 8}], "ap-aizen-hogyoku", "Bleach"],
  ["byakuya", "Byakuya", 5, "Rosa", "Mágico", "beam", "Senbonzakura", ["Mágico", {"magic": 8}], "ap-byakuya", "Bleach"],
  ["rukia", "Rukia", 4, "Branco", "Mágico", "beam", "Dança da Lua Branca", ["Mágico", {"magic": 8}], "ap-rukia", "Bleach"],
  ["yhwach", "Yhwach", 8, "Preto", "Suporte", "ward", "The Almighty", ["Suporte", {"hp": 8}], "ap-yhwach", "Bleach"],
  ["ichigo-bankai-verdadeiro", "Ichigo · Bankai verdadeiro", 7, "Preto", "Combatente", "rush", "Getsuga Duplo", ["Combatente", {"attack": 8}], "ap-ichigo-bankai-verdadeiro", "Bleach"],
  ["kenpachi", "Kenpachi", 6, "Preto", "Combatente", "rush", "Corte do Desafio", ["Combatente", {"attack": 8}], "ap-kenpachi", "Bleach"],
  ["shanks", "Shanks", 7, "Vermelho", "Combatente", "rush", "Corte do Imperador", ["Combatente", {"attack": 8}], "ap-shanks", "One Piece"],
  ["portgas-d-ace", "Portgas D. Ace", 5, "Vermelho", "Mágico", "beam", "Hiken", ["Mágico", {"magic": 8}], "ap-portgas-d-ace", "One Piece"],
  ["sanji", "Sanji", 4, "Laranja", "Combatente", "rush", "Diable Jambe", ["Combatente", {"attack": 8}], "ap-sanji", "One Piece"],
  ["kaido", "Kaido", 7, "Azul", "Guardião", "ward", "Sopro do Dragão", ["Guardião", {"defense": 8}], "ap-kaido", "One Piece"],
  ["chopper", "Chopper", 2, "Rosa", "Suporte", "heal", "Primeiros Socorros", ["Suporte", {"magic": 10}], "ap-chopper", "One Piece"],
  ["barba-branca-auge", "Barba Branca · auge", 8, "Branco", "Combatente", "rush", "Tremor do Mar", ["Combatente", {"attack": 8}], "ap-barba-branca-auge", "One Piece"],
  ["luffy-gear-5", "Luffy · Gear 5", 7, "Branco", "Combatente", "rush", "Ricochete", ["Combatente", {"attack": 8}], "ap-luffy-gear-5", "One Piece"],
  ["gol-d-roger", "Gol D. Roger", 8, "Dourado", "Combatente", "rush", "Investida do Rei", ["Combatente", {"attack": 8}], "ap-gol-d-roger", "One Piece"],
  ["alucard", "Alucard", 6, "Vermelho", "Combatente", "rush", "Regeneração Sombria", ["Combatente", {"attack": 8}], "ap-alucard", "Hellsing"],
  ["ban-pos-purgatorio", "Ban · pós-Purgatório", 6, "Vermelho", "Combatente", "rush", "Snatch", ["Combatente", {"attack": 8}], "ap-ban-pos-purgatorio", "Nanatsu no Taizai"],
  ["diane", "Diane", 4, "Laranja", "Guardião", "ward", "Muralha de Gideon", ["Guardião", {"defense": 8}], "ap-diane", "Nanatsu no Taizai"],
  ["gilthunder", "Gilthunder", 3, "Amarelo", "Combatente", "rush", "Lâmina de Raio", ["Amarelo", {"attack": 10}], "ap-gilthunder", "Nanatsu no Taizai"],
  ["king-asas-completas", "King · asas completas", 6, "Verde", "Mágico", "beam", "Chastiefol", ["Mágico", {"magic": 8}], "ap-king-asas-completas", "Nanatsu no Taizai"],
  ["howzer", "Howzer", 2, "Turquesa", "Mágico", "beam", "Rajada Giratória", ["Turquesa", {"magic": 10}], "ap-howzer", "Nanatsu no Taizai"],
  ["merlin", "Merlin", 6, "Roxo", "Suporte", "ward", "Infinity", ["Suporte", {"hp": 8}], "ap-merlin", "Nanatsu no Taizai"],
  ["gowther", "Gowther", 4, "Rosa", "Suporte", "ward", "Invasão", ["Suporte", {"hp": 8}], "ap-gowther", "Nanatsu no Taizai"],
  ["hawk", "Hawk", 1, "Rosa", "Suporte", "heal", "Resgate do Capitão", ["Rosa", {"hp": 8}], "ap-hawk", "Nanatsu no Taizai"],
  ["elizabeth-poderes-de-deusa", "Elizabeth · poderes de Deusa", 5, "Branco", "Suporte", "heal", "Luz Restauradora", ["Suporte", {"hp": 8}], "ap-elizabeth-poderes-de-deusa", "Nanatsu no Taizai"],
  ["meliodas-magia-verdadeira", "Meliodas · magia verdadeira", 8, "Preto", "Combatente", "rush", "Destruição Demoníaca", ["Combatente", {"attack": 8}], "ap-meliodas-magia-verdadeira", "Nanatsu no Taizai"],
  ["rei-dos-demonios", "Rei dos Demônios", 8, "Preto", "Guardião", "ward", "O Governante", ["Guardião", {"defense": 8}], "ap-rei-dos-demonios", "Nanatsu no Taizai"],
  ["escanor-the-one-ultimate", "Escanor · The One Ultimate", 7, "Dourado", "Combatente", "rush", "Sol Definitivo", ["Combatente", {"attack": 8}], "ap-escanor-the-one-ultimate", "Nanatsu no Taizai"],
  ["metal-bat", "Metal Bat", 5, "Vermelho", "Combatente", "rush", "Espírito de Luta", ["Combatente", {"attack": 8}], "ap-metal-bat", "One Punch Man"],
  ["genos", "Genos", 5, "Laranja", "Mágico", "beam", "Canhão Incinerador", ["Mágico", {"magic": 8}], "ap-genos", "One Punch Man"],
  ["saitama", "Saitama", 8, "Amarelo", "Combatente", "rush", "Soco Sério", ["Combatente", {"attack": 8}], "ap-saitama", "One Punch Man"],
  ["snek", "Snek", 2, "Amarelo", "Combatente", "rush", "Punho da Cobra", ["Amarelo", {"attack": 10}], "ap-snek", "One Punch Man"],
  ["tatsumaki", "Tatsumaki", 6, "Verde", "Mágico", "beam", "Tornado Psíquico", ["Mágico", {"magic": 8}], "ap-tatsumaki", "One Punch Man"],
  ["fubuki", "Fubuki", 4, "Verde", "Suporte", "beam", "Barreira Psíquica", ["Suporte", {"hp": 8}], "ap-fubuki", "One Punch Man"],
  ["mumen-rider", "Mumen Rider", 1, "Verde", "Guardião", "ward", "Investida da Justiça", ["Verde", {"hp": 8}], "ap-mumen-rider", "One Punch Man"],
  ["bang", "Bang", 5, "Azul", "Guardião", "ward", "Punho da Água Corrente", ["Guardião", {"defense": 8}], "ap-bang", "One Punch Man"],
  ["tanktop-master", "Tanktop Master", 3, "Azul", "Guardião", "ward", "Arremesso Tanktop", ["Guardião", {"defense": 8}], "ap-tanktop-master", "One Punch Man"],
  ["blast", "Blast", 7, "Roxo", "Guardião", "ward", "Portais Dimensionais", ["Guardião", {"defense": 8}], "ap-blast", "One Punch Man"],
  ["flashy-flash", "Flashy Flash", 5, "Branco", "Combatente", "rush", "Corte Instantâneo", ["Combatente", {"attack": 8}], "ap-flashy-flash", "One Punch Man"],
  ["garou-cosmico", "Garou Cósmico", 8, "Preto", "Combatente", "rush", "Cópia Cósmica", ["Combatente", {"attack": 8}], "ap-garou-cosmico", "One Punch Man"],
  ["vash", "Vash", 5, "Vermelho", "Suporte", "beam", "Disparo de Desarme", ["Suporte", {"hp": 8}], "ap-vash", "Trigun"],
  ["kurapika", "Kurapika", 4, "Vermelho", "Guardião", "ward", "Corrente Restritiva", ["Guardião", {"defense": 8}], "ap-kurapika", "Hunter × Hunter"],
  ["knuckle", "Knuckle", 3, "Laranja", "Combatente", "rush", "Hakoware", ["Combatente", {"attack": 8}], "ap-knuckle", "Hunter × Hunter"],
  ["meruem-pos-rosa", "Meruem · pós-Rosa", 8, "Verde", "Combatente", "rush", "Evolução do Rei", ["Combatente", {"attack": 8}], "ap-meruem-pos-rosa", "Hunter × Hunter"],
  ["killua", "Killua", 4, "Turquesa", "Combatente", "rush", "Godspeed", ["Combatente", {"attack": 8}], "ap-killua", "Hunter × Hunter"],
  ["leorio", "Leorio", 2, "Azul", "Suporte", "heal", "Atendimento Rápido", ["Suporte", {"magic": 10}], "ap-leorio", "Hunter × Hunter"],
  ["zushi", "Zushi", 1, "Azul", "Guardião", "ward", "Ten", ["Azul", {"resistance": 8}], "ap-zushi", "Hunter × Hunter"],
  ["hisoka", "Hisoka", 5, "Roxo", "Combatente", "rush", "Bungee Gum", ["Combatente", {"attack": 8}], "ap-hisoka", "Hunter × Hunter"],
  ["neferpitou", "Neferpitou", 6, "Rosa", "Combatente", "rush", "Terpsichora", ["Combatente", {"attack": 8}], "ap-neferpitou", "Hunter × Hunter"],
  ["biscuit", "Biscuit", 5, "Rosa", "Suporte", "beam", "Cookie", ["Suporte", {"hp": 8}], "ap-biscuit", "Hunter × Hunter"],
  ["chrollo", "Chrollo", 5, "Preto", "Mágico", "beam", "Skill Hunter", ["Mágico", {"magic": 8}], "ap-chrollo", "Hunter × Hunter"],
  ["gon-transformacao-adulta", "Gon · transformação adulta", 7, "Dourado", "Combatente", "rush", "Jajanken Final", ["Combatente", {"attack": 8}], "ap-gon-transformacao-adulta", "Hunter × Hunter"],
  ["inuyasha", "Inuyasha", 4, "Vermelho", "Combatente", "rush", "Cicatriz do Vento", ["Combatente", {"attack": 8}], "ap-inuyasha", "Inuyasha"],
  ["edward-elric", "Edward Elric", 3, "Vermelho", "Guardião", "ward", "Transmutação Relâmpago", ["Guardião", {"defense": 8}], "ap-edward-elric", "Fullmetal Alchemist"],
  ["kenshin-himura", "Kenshin Himura", 3, "Vermelho", "Combatente", "rush", "Saque Relâmpago", ["Combatente", {"attack": 8}], "ap-kenshin-himura", "Rurouni Kenshin"],
  ["magna", "Magna", 1, "Vermelho", "Mágico", "beam", "Bola de Fogo", ["Vermelho", {"magic": 8}], "ap-magna", "Black Clover"],
  ["mereoleona", "Mereoleona", 6, "Laranja", "Combatente", "rush", "Calidus Brachium", ["Combatente", {"attack": 8}], "ap-mereoleona", "Black Clover"],
  ["luck", "Luck", 4, "Amarelo", "Combatente", "rush", "Salto Relâmpago", ["Combatente", {"attack": 8}], "ap-luck", "Black Clover"],
  ["finral", "Finral", 2, "Verde", "Suporte", "ward", "Portal de Retirada", ["Verde", {"resistance": 10}], "ap-finral", "Black Clover"],
  ["noelle", "Noelle", 4, "Azul", "Guardião", "ward", "Berço do Dragão Marinho", ["Guardião", {"defense": 8}], "ap-noelle", "Black Clover"],
  ["zagred", "Zagred", 6, "Roxo", "Mágico", "beam", "Palavra Manifestada", ["Mágico", {"magic": 8}], "ap-zagred", "Black Clover"],
  ["vanessa", "Vanessa", 3, "Rosa", "Suporte", "beam", "Fio de Rouge", ["Suporte", {"hp": 8}], "ap-vanessa", "Black Clover"],
  ["licht", "Licht", 6, "Branco", "Guardião", "ward", "Espada Absorvente", ["Guardião", {"defense": 8}], "ap-licht", "Black Clover"],
  ["asta-devil-union", "Asta · Devil Union", 7, "Preto", "Combatente", "rush", "Antimagia", ["Combatente", {"attack": 8}], "ap-asta-devil-union", "Black Clover"],
  ["yami", "Yami", 5, "Preto", "Combatente", "rush", "Corte Dimensional", ["Combatente", {"attack": 8}], "ap-yami", "Black Clover"],
  ["lucius-zogratis", "Lucius Zogratis", 8, "Dourado", "Suporte", "ward", "Reescrita Temporal", ["Suporte", {"hp": 8}], "ap-lucius-zogratis", "Black Clover"],
  ["yuno-star-magic", "Yuno · Star Magic", 7, "Dourado", "Mágico", "beam", "Constelação", ["Mágico", {"magic": 8}], "ap-yuno-star-magic", "Black Clover"],
  ["naruto-modo-kurama", "Naruto · Modo Kurama", 6, "Laranja", "Combatente", "rush", "Manto da Raposa", ["Combatente", {"attack": 8}], "ap-naruto-modo-kurama", "Naruto"],
  ["gaara", "Gaara", 4, "Laranja", "Guardião", "ward", "Escudo de Areia", ["Guardião", {"defense": 8}], "ap-gaara", "Naruto"],
  ["minato", "Minato", 5, "Amarelo", "Combatente", "rush", "Deus Voador do Trovão", ["Combatente", {"attack": 8}], "ap-minato", "Naruto"],
  ["tenten", "Tenten", 1, "Turquesa", "Combatente", "rush", "Chuva de Armas", ["Combatente", {"attack": 8}], "ap-tenten", "Naruto"],
  ["kakashi-mangekyo", "Kakashi · Mangekyō", 5, "Azul", "Mágico", "beam", "Kamui", ["Mágico", {"magic": 8}], "ap-kakashi-mangekyo", "Naruto"],
  ["iruka", "Iruka", 1, "Azul", "Suporte", "ward", "Instrução de Campo", ["Azul", {"defense": 8}], "ap-iruka", "Naruto"],
  ["kaguya-otsutsuki", "Kaguya Ōtsutsuki", 8, "Branco", "Mágico", "beam", "Troca Dimensional", ["Mágico", {"magic": 8}], "ap-kaguya-otsutsuki", "Naruto"],
  ["neji", "Neji", 3, "Branco", "Guardião", "ward", "Rotação", ["Branco", {"defense": 10}], "ap-neji", "Naruto"],
  ["madara-dez-caudas", "Madara · Dez-Caudas", 7, "Preto", "Mágico", "beam", "Esferas da Verdade", ["Mágico", {"magic": 8}], "ap-madara-dez-caudas", "Naruto"],
  ["shikamaru", "Shikamaru", 2, "Preto", "Suporte", "ward", "Possessão das Sombras", ["Preto", {"resistance": 10}], "ap-shikamaru", "Naruto"],
  ["hagoromo-otsutsuki", "Hagoromo Ōtsutsuki", 8, "Dourado", "Suporte", "heal", "Chakra dos Seis Caminhos", ["Suporte", {"hp": 8}], "ap-hagoromo-otsutsuki", "Naruto"],
  ["arataka-reigen", "Arataka Reigen", 2, "Laranja", "Suporte", "ward", "Conversa Convincente", ["Suporte", {"defense": 10}], "ap-arataka-reigen", "Mob Psycho 100"],
  ["speedwagon", "Speedwagon", 1, "Laranja", "Suporte", "ward", "Apoio de Campo", ["Laranja", {"hp": 8}], "ap-speedwagon", "JoJo"],
  ["dio", "DIO", 6, "Amarelo", "Combatente", "rush", "The World", ["Combatente", {"attack": 8}], "ap-dio", "JoJo"],
  ["joseph-jovem", "Joseph · jovem", 2, "Amarelo", "Suporte", "ward", "Armadilha de Hamon", ["Amarelo", {"defense": 10}], "ap-joseph-jovem", "JoJo"],
  ["kakyoin", "Kakyoin", 4, "Verde", "Mágico", "beam", "Emerald Splash", ["Mágico", {"magic": 8}], "ap-kakyoin", "JoJo"],
  ["polnareff", "Polnareff", 4, "Azul", "Combatente", "rush", "Silver Chariot", ["Combatente", {"attack": 8}], "ap-polnareff", "JoJo"],
  ["jotaro", "Jotaro", 6, "Roxo", "Combatente", "rush", "Star Platinum", ["Combatente", {"attack": 8}], "ap-jotaro", "JoJo"],
  ["johnny-tusk-act-4", "Johnny · Tusk Act 4", 7, "Rosa", "Mágico", "beam", "Rotação Infinita", ["Mágico", {"magic": 8}], "ap-johnny-tusk-act-4", "JoJo"],
  ["josuke-parte-4", "Josuke · Parte 4", 5, "Rosa", "Suporte", "heal", "Crazy Diamond", ["Suporte", {"hp": 8}], "ap-josuke-parte-4", "JoJo"],
  ["pucci-made-in-heaven", "Pucci · Made in Heaven", 7, "Branco", "Combatente", "rush", "Contagem Acelerada", ["Combatente", {"attack": 8}], "ap-pucci-made-in-heaven", "JoJo"],
  ["bruno-bucciarati", "Bruno Bucciarati", 4, "Branco", "Guardião", "ward", "Sticky Fingers", ["Guardião", {"defense": 8}], "ap-bruno-bucciarati", "JoJo"],
  ["koichi", "Koichi", 3, "Branco", "Mágico", "beam", "Echoes Act 3", ["Mágico", {"magic": 8}], "ap-koichi", "JoJo"],
  ["giorno-gold-experience-requiem", "Giorno · Gold Experience Requiem", 8, "Dourado", "Suporte", "ward", "Retorno a Zero", ["Suporte", {"hp": 8}], "ap-giorno-gold-experience-requiem", "JoJo"],
  ["misaka-mikoto", "Misaka Mikoto", 4, "Amarelo", "Mágico", "beam", "Railgun", ["Mágico", {"magic": 8}], "ap-misaka-mikoto", "Toaru"],
  ["simon-tengen-toppa", "Simon · Tengen Toppa Gurren Lagann", 8, "Verde", "Combatente", "rush", "Força Espiral", ["Combatente", {"attack": 8}], "ap-simon-tengen-toppa", "Gurren Lagann"],
  ["frieren", "Frieren", 5, "Turquesa", "Mágico", "beam", "Zoltraak", ["Mágico", {"magic": 8}], "ap-frieren", "Frieren"],
  ["rimuru-tempest", "Rimuru Tempest", 8, "Azul", "Guardião", "ward", "Predação", ["Guardião", {"defense": 8}], "ap-rimuru-tempest", "Tensei Shitara Slime Datta Ken"],
  ["tetsuo-shima", "Tetsuo Shima", 7, "Roxo", "Mágico", "beam", "Colapso Psíquico", ["Mágico", {"magic": 8}], "ap-tetsuo-shima", "Akira"],
  ["ultimate-madoka", "Madoka Kaname · Ultimate Madoka", 8, "Rosa", "Suporte", "ward", "Lei dos Ciclos", ["Suporte", {"hp": 8}], "ap-ultimate-madoka", "Madoka Magica"],
  ["eternal-sailor-moon", "Eternal Sailor Moon", 8, "Branco", "Suporte", "heal", "Luz da Lua Eterna", ["Suporte", {"hp": 8}], "ap-eternal-sailor-moon", "Sailor Moon"],
  ["anos-voldigoad", "Anos Voldigoad", 7, "Preto", "Mágico", "beam", "Destruição da Fonte", ["Mágico", {"magic": 8}], "ap-anos-voldigoad", "The Misfit of Demon King Academy"],
];
const approvedArt = {"hoova-shisui":"hoova-shisui","zawa-cheon":"zawa-cheon","careca-kumagawa":"careca-kumagawa",
  "yamcha": "yamcha",
  "bulma": "bulma",
  "piccolo": "piccolo",
  "kuririn": "kuririn",
  "gohan": "gohan-namek",
  "tenshinhan": "tenshinhan",
  "freeza": "freeza-forma-final",
  "android17": "android-17-torneio-do-poder",
  "vegeta": "vegeta-super-saiyajin-blue",
  "broly": "broly-super",
  "goku": "goku-instinto-superior",
  "beerus": "beerus",
  "usopp": "usopp",
  "nami": "nami",
  "rocklee": "rock-lee",
  "zoro": "zoro",
  "law": "trafalgar-law",
  "gojo": "gojo",
  "netero": "netero",
  "mob": "mob-por-cento",
  "accelerator": "accelerator",
  "shinra_banshoman": "shinra-banshoman",
  "benimaru_shinmon": "benimaru-shinmon",
  "luminous": "luminous-valentine",
  "veldora": "veldora-tempest",
  "shinra": "shinra-kusakabe",
  "arthur": "arthur-boyle",
  "maki_oze": "maki-oze",
  "iris": "iris",
  "mayuri": "mayuri-kurotsuchi",
  "starrk": "coyote-starrk",
  "yoruichi": "yoruichi-shihoin",
  "urahara": "kisuke-urahara",
  "sukuna-forma-original": "sukuna-forma-original",
  "nanami": "nanami",
  "maki-desperta": "maki-desperta",
  "aoi-todo": "aoi-todo",
  "kasumi-miwa": "kasumi-miwa",
  "kenjaku": "kenjaku",
  "nobara": "nobara",
  "mahoraga": "mahoraga",
  "yuta": "yuta",
  "panda": "panda",
  "toji": "toji",
  "yamamoto": "yamamoto",
  "renji": "renji",
  "ikkaku": "ikkaku",
  "orihime": "orihime",
  "grimmjow": "grimmjow",
  "uryu-thousand-year-blood-war": "uryu-thousand-year-blood-war",
  "aizen-hogyoku": "aizen-hogyoku",
  "byakuya": "byakuya",
  "rukia": "rukia",
  "yhwach": "yhwach",
  "ichigo-bankai-verdadeiro": "ichigo-bankai-verdadeiro",
  "kenpachi": "kenpachi",
  "shanks": "shanks",
  "portgas-d-ace": "portgas-d-ace",
  "sanji": "sanji",
  "kaido": "kaido",
  "chopper": "chopper",
  "barba-branca-auge": "barba-branca-auge",
  "luffy-gear-5": "luffy-gear-5",
  "gol-d-roger": "gol-d-roger",
  "alucard": "alucard",
  "ban-pos-purgatorio": "ban-pos-purgatorio",
  "diane": "diane",
  "gilthunder": "gilthunder",
  "king-asas-completas": "king-asas-completas",
  "howzer": "howzer",
  "merlin": "merlin",
  "gowther": "gowther",
  "hawk": "hawk",
  "elizabeth-poderes-de-deusa": "elizabeth-poderes-de-deusa",
  "meliodas-magia-verdadeira": "meliodas-magia-verdadeira",
  "rei-dos-demonios": "rei-dos-demonios",
  "escanor-the-one-ultimate": "escanor-the-one-ultimate",
  "metal-bat": "metal-bat",
  "genos": "genos",
  "saitama": "saitama",
  "snek": "snek",
  "tatsumaki": "tatsumaki",
  "fubuki": "fubuki",
  "mumen-rider": "mumen-rider",
  "bang": "bang",
  "tanktop-master": "tanktop-master",
  "blast": "blast",
  "flashy-flash": "flashy-flash",
  "garou-cosmico": "garou-cosmico",
  "vash": "vash",
  "kurapika": "kurapika",
  "knuckle": "knuckle",
  "meruem-pos-rosa": "meruem-pos-rosa",
  "killua": "killua",
  "leorio": "leorio",
  "zushi": "zushi",
  "hisoka": "hisoka",
  "neferpitou": "neferpitou",
  "biscuit": "biscuit",
  "chrollo": "chrollo",
  "gon-transformacao-adulta": "gon-transformacao-adulta",
  "inuyasha": "inuyasha",
  "edward-elric": "edward-elric",
  "kenshin-himura": "kenshin-himura",
  "magna": "magna",
  "mereoleona": "mereoleona",
  "luck": "luck",
  "finral": "finral",
  "noelle": "noelle",
  "zagred": "zagred",
  "vanessa": "vanessa",
  "licht": "licht",
  "asta-devil-union": "asta-devil-union",
  "yami": "yami",
  "lucius-zogratis": "lucius-zogratis",
  "yuno-star-magic": "yuno-star-magic",
  "naruto-modo-kurama": "naruto-modo-kurama",
  "gaara": "gaara",
  "minato": "minato",
  "tenten": "tenten",
  "kakashi-mangekyo": "kakashi-mangekyo",
  "iruka": "iruka",
  "kaguya-otsutsuki": "kaguya-otsutsuki",
  "neji": "neji",
  "madara-dez-caudas": "madara-dez-caudas",
  "shikamaru": "shikamaru",
  "hagoromo-otsutsuki": "hagoromo-otsutsuki",
  "arataka-reigen": "arataka-reigen",
  "speedwagon": "speedwagon",
  "dio": "dio",
  "joseph-jovem": "joseph-jovem",
  "kakyoin": "kakyoin",
  "polnareff": "polnareff",
  "jotaro": "jotaro",
  "johnny-tusk-act-4": "johnny-tusk-act-4",
  "josuke-parte-4": "josuke-parte-4",
  "pucci-made-in-heaven": "pucci-made-in-heaven",
  "bruno-bucciarati": "bruno-bucciarati",
  "koichi": "koichi",
  "giorno-gold-experience-requiem": "giorno-gold-experience-requiem",
  "misaka-mikoto": "misaka-mikoto",
  "simon-tengen-toppa": "simon-tengen-toppa",
  "frieren": "frieren",
  "rimuru-tempest": "rimuru-tempest",
  "tetsuo-shima": "tetsuo-shima",
  "ultimate-madoka": "ultimate-madoka",
  "eternal-sailor-moon": "eternal-sailor-moon",
  "anos-voldigoad": "anos-voldigoad"
};

export function spriteFor(unit){
  const slug=approvedArt[unit.id];
  if(!slug)return CHARACTERS[unit.id].sprite;
  return "ap-"+slug+(unit.shiny?"-shiny":"");
}

const leadershipStats={hp:'PV',attack:'Ataque',magic:'Magia',defense:'Defesa',resistance:'Resistência',speed:'Velocidade'};
const leadershipKeys=Object.keys(leadershipStats);
export const CHARACTERS = Object.fromEntries(roster.map(([id,name,tier,color,role,kind,skill,[scope,bonuses],sprite,universe='Dragon Ball'])=>{
  const leader=scope+' · '+Object.entries(bonuses).map(([stat,value])=>leadershipStats[stat]+' +'+value+'%').join(' e ');
  return [id,{id,name,tier,color,role,kind,skill,leader,scope,leadership:leadershipKeys.map(k=>(bonuses[k]??0)/100),
    sprite:approvedArt[id]?'ap-'+approvedArt[id]:sprite,universe}];
}));
export const SKILL_EFFECTS = {
  koto:'Genjutsu de 150% da Magia. A próxima habilidade do alvo causa 35% menos dano. Na Arena, causa 175% da Magia e marca por 4 s, reduzindo o próximo golpe em 40%. Recarga de 8 s.',
  demonSword:'Três cortes de 65% do Ataque. O terceiro ignora metade da Defesa. Na Arena, dispara duas lâminas de 70%. Se alguma acertar, lança um corte de 100% que ignora metade da Defesa. Recarga de 7 s.',
  fiction:'Na campanha, apaga um golpe fatal contra si uma vez por batalha. Na Arena, lança um parafuso de 130% da Magia e protege o aliado ativo por 4 s. Apaga até 180% da Magia em dano do próximo golpe. Recarga de 10 s.',
  room:'ROOM cura o aliado em campo com a menor fração de PV em 150% da Magia. Gamma Knife atinge o inimigo com 135% da Magia e ignora 40% da Resistência. Recarga de 8 s. Nos duelos de bolas, ROOM abre onde Law ativou a habilidade, e o corte exige que o adversário toque o campo.',
  benihime:'Escudo de 220% da Magia no aliado em campo com a menor fração de PV e corte de 105% da Magia no adversário. Recarga de 8 s.',
  barreira:'Concede a cada aliado em campo um escudo de 100% da Defesa de Android 17. O próprio Android recebe 180% se estiver em campo. Recarga de 9 s.',
  death_ray:'Raio de 175% da Magia que ignora 25% da Resistência. Abaixo de 35% dos PV do alvo, passa para 235% da Magia. Recarga de 7 s.',
  final_flash:'Disparo de 215% do Ataque que causa dano dobrado a escudos. Recarga de 8 s.',
  furia:'Golpe de 165% do Ataque. Cada uso aumenta o próximo em 25 pontos percentuais, até 240%. Recarga de 6 s.',
  instinto:'Dois golpes de 100% do Ataque. Prepara uma esquiva de alvo único se estiver sem cargas. Recarga de 8 s.',
  dominio:'Atinge cada inimigo em campo com 155% da Magia em área e bloqueia suas ações por 1,5 s. Recarga de 12 s.',
  bodisatva:'Três golpes de 65% do Ataque. O terceiro ignora metade da Defesa. Recarga de 7 s.',
  despertar:'Onda de 165% da Magia contra todos os inimigos em campo. Com metade dos PV ou menos, Mob dispara a onda com 225%. Recarga de 9 s.',
  reescrita:"Golpeia com 190% do Ataque. Uma vez por luta, se um aliado em campo estiver com até 40% de PV, usa a ação para restaurar metade dos PV máximos do mais ferido. Recarga de 9 s.",
  nichirin:"Atinge o alvo com 180% do Ataque e os demais inimigos a até 28 unidades dele com 85% do Ataque. Recarga de 10 s.",
  ciclo_vital:"Cura em 200% da Magia o aliado em campo com a menor porcentagem de PV e atinge o adversário com 105% da Magia. Recarga de 9 s.",
  tempestade:"Desfere um raio de 185% da Magia que ignora 30% da Resistência. Um arco secundário de 75% da Magia atinge outro inimigo em campo, se houver. Recarga de 10 s.",

  ashisogi:"Enfraquece os ataques básicos do alvo em 35% por 4 s e causa dano mágico de 130% da Magia. Recarga de 9 s.",
  metralleta:"Dispara três tiros de 60% da Magia contra o mesmo alvo. Recarga de 9 s.",
  shunko:"Golpeia com 140% do Ataque e ganha uma carga de esquiva contra um golpe de alvo único. Recarga de 12 s.",
  excalibur:"O corte de plasma causa 145% do Ataque e ignora 35% da Defesa do alvo. Recarga de 7 s.",

  piccolo:'Cria um escudo de 110% da Magia e pode interceptar um golpe contra um aliado próximo nos 4,5 s seguintes.',
  bulma:'Aplica um escudo de 200% da Magia ao aliado com a menor porcentagem de PV, quando ele tem 95% de PV ou menos.',
  heal:'Cura o aliado com a menor porcentagem de PV em 130% da Magia, quando ele tem 95% de PV ou menos.',
  yamcha:'Causa dano físico equivalente a 160% do Ataque.',
  kuririn:'Causa dano mágico equivalente a 165% da Magia ao inimigo com menos PV.',
  beam:'Causa dano mágico equivalente a 165% da Magia.',
  beerus:'Remove o escudo, causa dano mágico equivalente a 240% da Magia e bloqueia a ressurreição se o golpe for fatal.',
  accelerator:'Reflete até duas habilidades de alvo único por luta, com recarga de 8 s e alcance de um espaço na ordem da formação.',
};
SKILL_EFFECTS.ward=SKILL_EFFECTS.piccolo;
SKILL_EFFECTS.rush=SKILL_EFFECTS.yamcha;
const recruitPools = TIERS.map((_,i)=>Object.values(CHARACTERS).filter(c=>c.tier===i+1));
const chanceByTier = [.57,.27,.11198,.038,.008,.00165,.00032,.00005];
const passives={
  'Haki do Rei':'Ao iniciar a luta, trava as ações inimigas por 1,5 s e aumenta o dano sofrido por eles em +15%. Uma ativação por equipe.',
  'Kaidō':'Inicia o combate com um escudo protetor equivalente a 18% dos PV máximos.',
  'Instinto Superior':'Esquiva dos dois primeiros golpes diretos de alvo único e contra-ataca com um golpe básico se puder agir.',
  'Restrição Celestial':'Intercepta os dois primeiros golpes de alvo único contra aliados próximos, sofrendo apenas 60% do dano. Na Arena, protege da reserva.',
  'Zenkai':'Uma vez por luta, sobrevive a um golpe fatal com 30% dos PV máximos e ganha +25% de Ataque e Magia até o fim do combate.',
  'Full Counter':'Reflete a primeira habilidade mágica de alvo único contra si ou um aliado próximo, devolvendo 150% do dano-base.',
  'The World':'Após a primeira habilidade principal bem-sucedida, para o tempo por 2 s e reduz pela metade a recarga restante da habilidade.',
  'Voto de Nen':'Concede +20% de dano em 1 vaga. Opcionalmente ative Última Aposta na ficha para causar +70% de dano ocupando 2 vagas.',
  'Made in Heaven':'Causa +25% de dano durante toda a luta. Na primeira ação ofensiva, ativa Aceleração por 4 s (−35% intervalo no portador e −20% nos aliados).',
  'Domínio Absoluto':'Inicia o combate com barreira de 25% dos PV máximos, reduz em 15% todo dano recebido e anula o primeiro atordoamento.'
};
export const TRAIT_MIGRATION={'Shunpo':'Respiração do Trovão','Haki da Observação':'Instinto Superior'};
const T=(name,tier,odds,buffs)=>({name,tier,odds,buffs,passive:passives[name]??null,rarity:TIERS[tier-1]});
// 16 Traits: exatamente 2 por raridade (Ofensiva/Ágil + Defensiva/Tática), estritamente crescentes de Comum a Transcendente.
export const TRAITS = [
  T('Concentração Total',1,6,[.05,.02,.02,.04,.04,0]),
  T('Reforço Amaldiçoado',1,6,[.03,.05,.05,.02,.02,.02]),
  T('Haki do Armamento',2,14,[.07,.08,.05,.08,.06,.02]),
  T('Ten',2,14,[.07,.05,.08,.06,.08,.02]),
  T('Modo Sábio',3,30,[.11,.09,.10,.10,.10,.05]),
  T('Respiração do Trovão',3,30,[.09,.12,.11,.08,.08,.08]),
  T('Haki do Rei',4,60,[.13,.16,.16,.11,.11,.08]),
  T('Kaidō',4,60,[.15,.13,.14,.14,.14,.09]),
  T('Instinto Superior',5,120,[.17,.20,.20,.14,.14,.13]),
  T('Restrição Celestial',5,120,[.20,.16,.16,.18,.18,.10]),
  T('Zenkai',6,250,[.23,.24,.24,.18,.18,.14]),
  T('Full Counter',6,250,[.21,.22,.24,.23,.23,.14]),
  T('The World',7,600,[.27,.30,.30,.23,.23,.18]),
  T('Voto de Nen',7,600,[.30,.27,.27,.26,.26,.16]),
  T('Made in Heaven',8,1500,[.34,.36,.36,.28,.28,.24]),
  T('Domínio Absoluto',8,1500,[.38,.33,.33,.34,.34,.20]),
];
const initial = ['piccolo','yamcha','kuririn','bulma'];
const position = [[72,47],[56,72],[39,28],[22,59]];
const HOUR = 3600000;
export const UPGRADES = {
  ritmo:{name:'Ritmo de expedição',worlds:[1,2,3,4,5,6,7,8,9,10],costs:[180,1000,3500,9000,20000,40000,70000,160000,400000,1000000],
    values:[15,14,13,13,12,12,11,11,10,9,8],goldBonus:[0,0,0,5,5,10,10,15,15,15,15],
    unit:' s',description:'Reduz a espera entre encontros ou aumenta o ouro das vitórias em encontros comuns e de elite.'},
  sorte:{name:'Sorte',worlds:[1,1,1,2,3,5,7,8,10],costs:[50,125,300,1000,3500,12000,36000,90000,200000],values:[10,20,30,40,50,60,70,80,90,100],unit:'%',description:'Até 50%, aumenta a chance de encontrar um recruta em lutas comuns. Cada ponto acima de 50% aumenta em 1% relativo a chance de esse recruta ser Raro ou superior.'},
  ouro:{name:'Bônus de ouro',worlds:[1,1,1,2,4,6,8],costs:[75,180,400,2000,18000,90000,250000],values:[0,10,20,35,50,65,80,100],unit:'%',description:'Acrescenta ouro às vitórias em encontros comuns e de elite.'},
  xp:{name:'Experiência compartilhada',worlds:[1,1,1,2,4,6,8],costs:[60,150,325,1600,14000,75000,210000],values:[0,25,40,60,70,80,90,100],unit:'%',description:'Distribui entre os reservas uma fração da XP que um titular recebe por vitória. Cada titular mantém sua recompensa integral.'},
  rastreio:{name:'Rastreio de raros',worlds:[1,2,4,6,9,10],costs:[100,600,4500,24000,100000,250000],values:[16,18,21,24,28,32,36],unit:'%',description:'Chance de um recruta ser de raridade Rara ou superior. Cada uma dessas raridades recebe o mesmo aumento proporcional.'},
  treino:{name:'Treino de combate',worlds:[1,2,4,7,9,10],costs:[80,700,5000,30000,70000,140000],values:[0,10,20,30,40,60,80],unit:'%',description:'Aumenta a XP por vitória na campanha. O bônus também entra no cálculo da experiência compartilhada.'},
  enfermaria:{name:'Enfermaria',worlds:[1,3,5,8,9,10],costs:[90,1000,6500,45000,70000,140000],values:[20,18,16,14,12,10,8],unit:' s',description:'Reduz o tempo de recuperação de titulares derrotados na exploração, inclusive quando a equipe inteira cai.'},
  brilho:{name:'Caçador de Shinies',worlds:[4,6,8,10],costs:[8000,40000,160000,450000],values:[0,10,20,35,50],unit:'%',description:'Aumenta proporcionalmente a chance de encontrar variantes Shiny em recrutamentos.'},
  sintonia:{name:'Sintonia de Traits',worlds:[5,7,9,10],costs:[15000,65000,220000,550000],values:[0,10,20,30,40],unit:'%',description:'Aumenta a chance de recrutas naturais virem com Traits Épicas ou superiores.'},
};
export const xpFor = level => 26 + level*12 + Math.round(1.25*level**2 + .070*level**3);
const scale = level => 1 + .1*(level-1) + .001*(level-1)**2;
const thresholds=[0,0];
for(let level=1;level<100;level++)thresholds.push(thresholds[level]+xpFor(level));
const xpTo=level=>thresholds[level];
export function levelAt(xp){
  let low=1,high=100;
  while(low<high){const mid=Math.ceil((low+high)/2);if(xp>=thresholds[mid])low=mid;else high=mid-1;}
  return low;
}
export function xpProgress(xp,cap=100){
  const level=levelAt(xp);
  return {level,current:xp-xpTo(level),required:level<cap?xpFor(level):0};
}
export const maxLevel = state=>Math.max(1,...state.team.map(id=>levelAt(state.collection.find(x=>x.uid===id).xp)));
export const readyForBoss = state=>state.team.length>0 && state.finalWins>=(state.bossGoal??15) && !state.completed;
export const upgradeLevel = (state,id)=>state.upgrades?.[id]??(id==='ritmo'&&state.upgraded?1:0);
const upgradeValue = (state,id)=>UPGRADES[id].values[upgradeLevel(state,id)];
export const waitFor = state=>upgradeValue(state,'ritmo')*1000;

export function buyUpgrade(state,id){
  if(!Object.hasOwn(UPGRADES,id))return false;
  const level=upgradeLevel(state,id);
  const cost=UPGRADES[id].costs[level];
  if(cost===undefined||state.gold<cost||(state.unlocked??0)+1<UPGRADES[id].worlds[level])return false;
  state.gold-=cost;
  (state.upgrades??={})[id]=level+1;
  return true;
}

export function fresh(now=Date.now(),seed=Date.now()>>>0){
  const collection = initial.map(id=>({uid:`initial-${id}`,id,xp:0,serial:1,shiny:false,trait:null,odds:null}));
  return {version:1,seed,created:now,collection,team:collection.map(x=>x.uid),positions:Object.fromEntries(collection.map((x,i)=>[x.uid,position[i]])),leader:collection[0].uid,area:0,gold:0,wins:0,losses:0,finalWins:0,streak:0,upgrades:{},completed:false,world:0,unlocked:0,journey:{},autoRoutes:true,paused:false,running:true,nextAt:now,waitDuration:0,pending:null,index:0,clock:now,log:[]};
}

const starterBonus = {piccolo:[.05,0,0,.05,0,0],yamcha:[0,.05,0,0,0,.05],kuririn:[0,0,.05,0,0,0],bulma:[0,0,0,0,.05,0]};
function leaderBuff(leader,member){
  if(!leader)return [];
  return [member.role,member.color,member.universe,'Equipe'].includes(leader.scope)?leader.leadership:[];
}

export const MAX_STARS=5;
export const TRAIT_PITY_LIMIT=25;
export const PRESET_SLOTS=['exploracao','arena','torre','raid'];
export const PRESET_LABELS={exploracao:'Exploração',arena:'Arena',torre:'Torre',raid:'Raid'};
export const RAID_MILESTONES=[
  {damage:10000,label:'10 mil',gold:5000,items:{essence:1}},
  {damage:25000,label:'25 mil',gold:15000,traitItems:1},
  {damage:45000,label:'45 mil',gold:35000,items:{essence:2,xpTome:1}},
  {damage:80000,label:'80 mil',gold:75000,traitItems:1,items:{catalyst:1}},
  {damage:150000,label:'150 mil',gold:150000,traitItems:2,items:{traitLock:1}},
];
export const WORLD_BOSS_MILESTONES=[
  {damage:100000,label:'100 mil',gold:20000,traitItems:1,items:{essence:1}},
  {damage:400000,label:'400 mil',gold:50000,traitItems:2,items:{essence:2}},
  {damage:1000000,label:'1M',gold:100000,traitItems:2,items:{xpTome:2,catalyst:1}},
  {damage:2500000,label:'2,5M',gold:200000,traitItems:3,items:{essence:4,traitLock:1}},
  {damage:6000000,label:'6M',gold:400000,traitItems:5,items:{catalyst:2,traitLock:1}},
];
export const TOWER_AFFIXES=[
  {id:'padrao',name:'Combate padrão',desc:'Sem modificadores ambientais.',apply:()=>{}},
  {id:'fisica',name:'Fúria Física',desc:'+20% Ataque e −15% Magia para todos.',apply:f=>{f.attack=Math.round(f.attack*1.2);f.magic=Math.round(f.magic*.85);}},
  {id:'arcana',name:'Maré Arcana',desc:'+20% Magia e −15% Ataque para todos.',apply:f=>{f.magic=Math.round(f.magic*1.2);f.attack=Math.round(f.attack*.85);}},
  {id:'bastiao',name:'Bastião',desc:'+25% PV e +15% Defesa/Resistência.',apply:f=>{f.hp=Math.round(f.hp*1.25);f.defense=Math.round(f.defense*1.15);f.resistance=Math.round(f.resistance*1.15);}},
  {id:'aceleracao',name:'Fluxo Acelerado',desc:'+20% Velocidade para todos.',apply:f=>{f.speed=Math.round(f.speed*1.2);}},
];
export const WEEKLY_TOWER_FLOORS=15;
export const WEEKLY_TOWER_RULES=[
  {id:'no_transcendent',name:'Sem Transcendentes',desc:'Apenas personagens de Comum até Secreta.',allow:c=>c.tier<8},
  {id:'classic',name:'Clássicos (até Mítica)',desc:'Apenas personagens de Comum até Mítica.',allow:c=>c.tier<=5},
  {id:'warm',name:'Cores Quentes',desc:'Apenas Vermelho, Laranja, Amarelo, Rosa ou Dourado.',allow:c=>['Vermelho','Laranja','Amarelo','Rosa','Dourado'].includes(c.color)},
  {id:'cool',name:'Cores Frias',desc:'Apenas Verde, Turquesa, Azul, Roxo, Branco ou Preto.',allow:c=>['Verde','Turquesa','Azul','Roxo','Branco','Preto'].includes(c.color)},
  {id:'tactical',name:'Guardiões & Suportes',desc:'Apenas Guardiões e Suportes entram em campo.',allow:c=>['Guardião','Suporte'].includes(c.role)},
];

// Build 57 stored claims by the old damage thresholds, in the same reward order.
function normalizeClaims(claimed,milestones,oldThresholds){
  return [...new Set(claimed.map(damage=>{
    const index=oldThresholds.indexOf(damage);
    return index<0?damage:milestones[index].damage;
  }))];
}
export const raidClaims=claimed=>normalizeClaims(claimed,RAID_MILESTONES,[50000,250000,750000,2000000,5000000]);
export const worldBossClaims=claimed=>normalizeClaims(claimed,WORLD_BOSS_MILESTONES,[500000,2000000,10000000,50000000,200000000]);

export function grantItems(state,bundle){
  if(!bundle)return;
  if(bundle.gold)state.gold=(state.gold??0)+bundle.gold;
  if(bundle.traitItems)state.traitItems=(state.traitItems??0)+bundle.traitItems;
  if(bundle.arenaTrophies)state.arenaTrophies=(state.arenaTrophies??0)+bundle.arenaTrophies;
  if(bundle.items){
    state.items??={};
    for(const [k,v] of Object.entries(bundle.items)){
      if(v>0)state.items[k]=(state.items[k]??0)+v;
    }
  }
}

export function awakenCost(unit){
  const card=CHARACTERS[unit?.id];
  const stars=Math.max(0,Math.min(MAX_STARS,unit?.stars??0));
  if(!card||stars>=MAX_STARS)return null;
  const next=stars+1;
  return {
    next,
    gold:card.tier*15000*next,
    essence:next*Math.max(1,card.tier-3)
  };
}

export function dexMastery(state){
  if(!state)return {charTiers:0,shinyTiers:0,allBonus:0,offenseBonus:0,goldBonus:0,completedUniverses:[],universes:[]};
  const {characters,totals}=dexSummary(state);
  const byUni=new Map();
  for(const c of characters){
    const entry=byUni.get(c.universe)??{universe:c.universe,seen:0,total:0};
    entry.total++;
    if(c.seen)entry.seen++;
    byUni.set(c.universe,entry);
  }
  const universes=[...byUni.values()].sort((a,b)=>a.universe.localeCompare(b.universe,'pt-BR'));
  const completedUniverses=universes.filter(u=>u.total>0&&u.seen===u.total).map(u=>u.universe);
  const charTiers=Math.floor(totals.seenChars/15);
  const shinyTiers=Math.floor(totals.shinyChars/10);
  return {
    charTiers,shinyTiers,
    allBonus:charTiers*0.01,
    offenseBonus:shinyTiers*0.01,
    goldBonus:charTiers*0.03,
    completedUniverses,
    universes
  };
}

export function slotTraits(unit,index=unit.activeSlot??0){
  const stored=unit.traitSlots?.[index]??(index===0&&unit.trait?[unit.trait]:[]);
  return Array.isArray(stored)?[...new Set(stored.map(n=>TRAIT_MIGRATION[n]??n))].filter(name=>TRAITS.some(t=>t.name===name)).slice(0,3):[];
}
function pickWeightedTrait(random,pool){
  let weight=random()*pool.reduce((n,t)=>n+1/t.odds,0);
  const index=pool.findIndex(t=>(weight-=1/t.odds)<0);
  return pool.splice(index<0?pool.length-1:index,1)[0];
}
function rollLoadout(random,{lockTrait=null,catalyst=false,pity=false}={}){
  const multiRoll=random();
  let count;
  if(lockTrait){
    count=multiRoll<(catalyst?0.18:0.08)?3:2;
  }else if(catalyst){
    count=multiRoll<0.16?(multiRoll<0.01?3:2):1;
  }else{
    count=multiRoll<0.05?(multiRoll<0.0005?3:2):1;
  }
  const basePool=catalyst?TRAITS.filter(t=>t.tier>=3):TRAITS.slice();
  const pool=basePool.slice(),picked=[];
  if(lockTrait&&TRAITS.some(t=>t.name===lockTrait)){
    picked.push(lockTrait);
    const idx=pool.findIndex(t=>t.name===lockTrait);
    if(idx>=0)pool.splice(idx,1);
  }
  if(pity&&!picked.some(n=>(TRAITS.find(t=>t.name===n)?.tier??0)>=5)){
    const mythicPool=pool.filter(t=>t.tier>=5);
    if(mythicPool.length){
      const chosen=pickWeightedTrait(random,mythicPool);
      picked.push(chosen.name);
      const idx=pool.findIndex(t=>t.name===chosen.name);
      if(idx>=0)pool.splice(idx,1);
    }
  }
  while(picked.length<count&&pool.length){
    picked.push(pickWeightedTrait(random,pool).name);
  }
  return picked;
}
// Exact chance for this unordered set: sum every draw order without replacement.
export function loadoutChance(names){
  if(!names.length||names.length>3)return 0;
  const weights=names.map(name=>1/TRAITS.find(t=>t.name===name).odds);
  function orders(left,total){
    if(left.length===0)return 1;
    return left.reduce((p,w,i)=>p+w/total*orders(left.filter((_,j)=>j!==i),total-w),0);
  }
  return [0,.95,.0495,.0005][names.length]*orders(weights,TRAITS.reduce((n,t)=>n+1/t.odds,0));
}
function changeTraitSlot(state,action){
  const {uid,slot}=action;
  const unit=state.collection.find(u=>u.uid===uid);
  if(!unit||![0,1].includes(slot))return false;
  const slots=[slotTraits(unit,0),slotTraits(unit,1)];
  if(action.type==='reroll'){
    if(!(state.traitItems>=1)||action.roll!==(state.traitRolls??0))return false;
    const useCatalyst=action.useCatalyst===true;
    const lockTrait=typeof action.lockTrait==='string'&&action.lockTrait?action.lockTrait:null;
    if(useCatalyst&&!((state.items?.catalyst??0)>=1))return false;
    if(lockTrait){
      if(!((state.items?.traitLock??0)>=1)||!slots[slot].includes(lockTrait))return false;
    }
    const pity=(state.traitPity??0)+1>=TRAIT_PITY_LIMIT;
    state.traitRolls=(state.traitRolls??0)+1;
    recordDex(state,unit);
    const rolled=rollLoadout(rng(state.seed,0x54524149^state.traitRolls),{lockTrait,catalyst:useCatalyst,pity});
    slots[slot]=rolled;
    state.traitItems--;
    if(useCatalyst)state.items.catalyst--;
    if(lockTrait)state.items.traitLock--;
    const hitMythic=rolled.some(n=>(TRAITS.find(t=>t.name===n)?.tier??0)>=5);
    state.traitPity=hitMythic?0:(state.traitPity??0)+1;
  }else{
    if(!slots[slot].length||slot===(unit.activeSlot??0))return false;
    unit.activeSlot=slot;
  }
  unit.traitSlots=slots;
  const active=slots[unit.activeSlot??0];
  unit.trait=active[0]??null;
  recordDex(state,unit);
  if(!active.includes('Voto de Nen'))delete unit.nen;
  return true;
}
export function fighter(unit, coords=[55,50], leader=null, tactical=false, mastery=null){
  const card=CHARACTERS[unit.id];
  const level=levelAt(unit.xp);
  const growth=scale(level);
  const names=slotTraits(unit);
  const buffs=names.map(n=>TRAITS.find(t=>t.name===n).buffs);
  const aura=leaderBuff(leader,card);
  const stars=Math.max(0,Math.min(MAX_STARS,unit.stars??0));
  const starMult=1+stars*0.04;
  const uniBonus=mastery?.completedUniverses?.includes(card.universe)?0.05:0;
  const globalBonus=(mastery?.allBonus??0)+uniBonus;
  const offBonus=mastery?.offenseBonus??0;
  const [hp,attack,magic,defense,resistance,speed]=baseStats[card.tier-1].map((base,i)=>{
    const mBoost=1+globalBonus+(i<=2?offBonus:0);
    const sBoost=i===5?(stars>=5?starMult*1.05:starMult):starMult;
    return Math.round(base*(1+roles[card.role][i])*(1+(starterBonus[card.id]?.[i]||0))*(1+buffs.reduce((sum,b)=>sum+b[i],0))*(1+(aura[i]||0))*sBoost*mBoost*(i===5?1:growth*(unit.shiny?1.12:1)));
  });
  const [x,y]=coords;
  return {...card,stars,signatureAssist:card.tier>=5&&card.role==='Suporte', uid:unit.uid,trait:unit.trait,traits:names,nen:names.includes("Voto de Nen")&&unit.nen===true, level, x,y,hp,attack,magic,defense,resistance,speed,scale:growth,interval:tactical?Math.max(600,Math.round(300000/speed/100)*100):3000,magicBasic:card.role==='Mágico'||card.role==='Suporte',evade:names.includes('Instinto Superior')?2:0,survive:names.includes('Zenkai')?1:0,sprite:spriteFor(unit)};
}

function chachaBlock(keyWords, counter, nonce0, nonce1){
  const init=new Uint32Array([
    0x61707865,0x3320646e,0x79622d32,0x6b206574,
    keyWords[0],keyWords[1],keyWords[2],keyWords[3],
    keyWords[4],keyWords[5],keyWords[6],keyWords[7],
    counter>>>0,Math.floor(counter/4294967296)>>>0,nonce0>>>0,nonce1>>>0
  ]);
  const x=new Uint32Array(init);
  const qr=(a,b,c,d)=>{
    x[a]=(x[a]+x[b])>>>0;x[d]=((x[d]^x[a])<<16|(x[d]^x[a])>>>16)>>>0;
    x[c]=(x[c]+x[d])>>>0;x[b]=((x[b]^x[c])<<12|(x[b]^x[c])>>>20)>>>0;
    x[a]=(x[a]+x[b])>>>0;x[d]=((x[d]^x[a])<<8|(x[d]^x[a])>>>24)>>>0;
    x[c]=(x[c]+x[d])>>>0;x[b]=((x[b]^x[c])<<7|(x[b]^x[c])>>>25)>>>0;
  };
  for(let r=0;r<10;r++){
    qr(0,4,8,12);qr(1,5,9,13);qr(2,6,10,14);qr(3,7,11,15);
    qr(0,5,10,15);qr(1,6,11,12);qr(2,7,8,13);qr(3,4,9,14);
  }
  for(let i=0;i<16;i++)x[i]=(x[i]+init[i])>>>0;
  return x;
}
function rng(seed,index){
  if(typeof seed==='string'&&/^[0-9a-f]{64}$/i.test(seed)){
    const keyWords=new Uint32Array(8);
    for(let i=0;i<8;i++)keyWords[i]=parseInt(seed.slice(i*8,i*8+8),16)>>>0;
    let blockCounter=0,offset=16,words=null;
    const nonce0=index>>>0,nonce1=Math.floor(index/4294967296)>>>0;
    return ()=>{
      if(offset>=16){words=chachaBlock(keyWords,blockCounter++,nonce0,nonce1);offset=0;}
      return words[offset++]/4294967296;
    };
  }
  let state=(seed^Math.imul(index+1,2654435761))>>>0 || 1;
  return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
}
function isEpicTrait(t){return (t.tier??(t.odds>=50?4:1))>=4;}
function pickTrait(random,qualityBoost=0){
  const mult=t=>isEpicTrait(t)?(1+qualityBoost):1;
  let p=random();
  for(const t of TRAITS){p-=mult(t)/t.odds;if(p<0)return t;}
  return null;
}
function recruitWeights(rarePercent){
  const base=UPGRADES.rastreio.values[0];
  const clamped=Math.min(65,Math.max(base,rarePercent));
  if(clamped===base)return chanceByTier;
  const delta=(clamped-base)/100;
  // Transfere de Comum (e de Incomum se necessário) mantendo pesos sempre positivos.
  const fromCommon=Math.min(chanceByTier[0]-.05,delta);
  const fromUncommon=Math.max(0,delta-fromCommon);
  return chanceByTier.map((weight,i)=>{
    if(i===0)return weight-fromCommon;
    if(i===1)return weight-fromUncommon;
    return weight*clamped/base;
  });
}
export function recruitRates(luckPercent,rastreioPercent){
  return {encounter:Math.min(50,luckPercent),rare:Math.min(65,rastreioPercent*(100+Math.max(0,luckPercent-50))/100)};
}
export function rollRecruit(random,luck=.10,universe='Dragon Ball',rarePercent=UPGRADES.rastreio.values[0],shinyBoost=0,traitBoost=0){
  const rates=recruitRates(luck*100,rarePercent);
  const chance=rates.encounter/100;
  if(random()>=chance) return null;
  let p=random(),tier=1;
  const weights=recruitWeights(rates.rare);
  for(const weight of weights){if(p<weight)break;p-=weight;tier++;}
  tier=Math.min(tier,8);
  const pool=recruitPools[tier-1];
  const local=pool.filter(c=>c.universe===universe);
  // One ticket per character globally, plus a second ticket for each local character.
  const total=pool.length+local.length;
  const ticket=Math.floor(random()*total);
  const card=ticket<pool.length?pool[ticket]:local[ticket-pool.length];
  const cardChance=(card.universe===universe?2:1)/total;
  const baseShiny=tier>=7?.10:.05;
  const shinyP=Math.min(.25,baseShiny*(1+shinyBoost));
  const shiny=random()<shinyP;
  const trait=pickTrait(random,traitBoost);
  const traitMult=t=>isEpicTrait(t)?(1+traitBoost):1;
  const totalTraitP=TRAITS.reduce((sum,t)=>sum+traitMult(t)/t.odds,0);
  const traitP=trait?traitMult(trait)/trait.odds:Math.max(.05,1-totalTraitP);
  return {id:card.id,shiny,trait:trait?.name??null,odds:Math.round(1/(chance*weights[tier-1]*cardChance*(shiny?shinyP:1-shinyP)*traitP))};
}

export const SALE_PRICES=[8,20,50,125,350,1000,3500,12000];
export const RECOVERY_MS=20000;
export function readyAt(state,uid){
  return Math.max(state.partyRecovery??0,state.recovery?.[uid]??0);
}
function firstReady(state){
  return Math.min(...state.team.map(uid=>readyAt(state,uid)));
}

// Progressão por mundo (1 a 10): escala para valorizar raridades, upgrades e formação ao longo de 1–3 dias.
const enemyBonuses = [
  {hp:0,    damage:0,    bossHp:0,    bossDamage:0},    // M1 Namek
  {hp:.18,  damage:.12,  bossHp:.26,  bossDamage:.16},  // M2 Arlong Park
  {hp:.42,  damage:.26,  bossHp:.62,  bossDamage:.38},  // M3 Exames Chūnin
  {hp:.72,  damage:.45,  bossHp:1.08, bossDamage:.64},  // M4 Soul Society
  {hp:1.10, damage:.66,  bossHp:1.68, bossDamage:.95},  // M5 Jujutsu Kaisen
  {hp:1.55, damage:.90,  bossHp:2.40, bossDamage:1.28}, // M6 Black Clover
  {hp:2.05, damage:1.15, bossHp:3.20, bossDamage:1.62}, // M7 Nanatsu no Taizai
  {hp:2.65, damage:1.42, bossHp:4.10, bossDamage:1.98}, // M8 JoJo
  {hp:3.30, damage:1.70, bossHp:5.10, bossDamage:2.35}, // M9 Hunter × Hunter
  {hp:4.00, damage:2.00, bossHp:6.20, bossDamage:2.75}, // M10 One Punch Man
];

export function makeBattle(state,start,boss=false,towerFloor=0){
  const random=rng(state.seed,state.index++);
  const encounterWorld=towerFloor?(towerFloor-1)%WORLDS.length:state.world??0;
  const world=WORLDS[encounterWorld];
  const area=world.areas[state.area];
  const elite=!boss&&state.area===2&&state.index%7===0;
  const special=boss?world.boss:elite?world.elite:null;
  const leader=state.collection.find(c=>c.uid===state.leader);
  const available=state.team.filter(uid=>readyAt(state,uid)<=start);
  const mastery=dexMastery(state);
  const team=available.map(uid=>fighter(state.collection.find(c=>c.uid===uid),state.positions[uid],available.includes(leader?.uid)?CHARACTERS[leader.id]:null,!!special,mastery));
  const level=towerFloor?90+towerFloor:special?special.level:Math.max(area.levels[0],Math.min(area.levels[1],maxLevel(state)+Math.floor(random()*3)-1));
  const recruit=special?null:rollRecruit(random,upgradeValue(state,'sorte')/100,world.universe,upgradeValue(state,'rastreio'),upgradeValue(state,'brilho')/100,upgradeValue(state,'sintonia')/100);
  const grow=scale(level)*(towerFloor?1+.06*(towerFloor-1):1);
  const bonus=enemyBonuses[Math.min(enemyBonuses.length-1,encounterWorld)];
  const hpBonus=boss?bonus.bossHp:elite?(bonus.hp+bonus.bossHp)/2:bonus.hp;
  const damageBonus=boss?bonus.bossDamage:elite?(bonus.damage+bonus.bossDamage)/2:bonus.damage;
  const [rawHp,rawPower,def,res]=(special?.base??area.base).map(x=>Math.round(x*grow));
  const hp=Math.round(rawHp*(1+hpBonus)),power=Math.round(rawPower*(1+damageBonus));
  const baseEnemy={name:towerFloor?`Torre ${towerFloor} · ${special.name}`:special?.name??area.enemy,hp,attack:power,magic:boss?Math.round(power*.88):power,defense:def,resistance:res,scale:grow,color:boss?world.boss.color:area.color,level,sprite:`enemy-${encounterWorld+1}-${boss?5:elite?4:state.area+1}`,interval:boss?3200:3000,skill:boss?'Ofensiva de '+special.name:null,kind:boss?world.boss.kind:null,x:60,y:50};
  const candidate = recruit ? fighter({...recruit,xp:xpTo(level)},[60,50],null,false) : null;
  const enemy = candidate ? {...baseEnemy,name:candidate.name,sprite:candidate.sprite,skill:candidate.skill,trait:candidate.trait,color:candidate.color,kind:candidate.kind, hp:Math.max(hp,Math.round(candidate.hp*1.65)),attack:Math.max(power,candidate.attack),magic:Math.max(power,candidate.magic),magicBasic:candidate.magicBasic,defense:Math.max(def,candidate.defense),resistance:Math.max(res,candidate.resistance),evade:candidate.evade,survive:candidate.survive} : baseEnemy;
  const damageBoost=boss?1.30:elite?1.45:1.55;
  enemy.attack=Math.round(enemy.attack*damageBoost);
  enemy.magic=Math.round(enemy.magic*damageBoost);
  const result=new Combate([team,[enemy]],{mode:'equipe'}).run();
  const simulatedTime=result.seconds*1000;
  const duration=Math.max(1200,Math.min(boss?16000:6000,simulatedTime/(boss?2:4)));
  const reserveShare=upgradeValue(state,'xp')/100;
  const reserves=reserveShare?state.collection.filter(unit=>!state.team.includes(unit.uid)&&unit.xp<xpTo(levelCap(state))).map(unit=>unit.uid):[];
  return {start,end:start+duration,boss,elite,towerFloor,world:encounterWorld,area:state.area,level,team,enemy,recruit,result,
    goldReward:Math.round((6+2*level)*1.2*(boss?8:(elite?2:1)*(1+(upgradeValue(state,'ouro')+UPGRADES.ritmo.goldBonus[upgradeLevel(state,'ritmo')])/100+mastery.goldBonus))),
    xpBonus:upgradeValue(state,'treino')/100,recoveryMs:upgradeValue(state,'enfermaria')*1000,reserveShare,reserves};
}

function shareExperience(state,battle,xp){
  let available=Math.floor(xp*(battle.reserveShare??0));
  if(!available||!battle.reserves?.length)return 0;
  const maxXp=xpTo(levelCap(state));
  const reserves=new Set(battle.reserves);
  const eligible=state.collection.filter(unit=>reserves.has(unit.uid)&&unit.xp<maxXp).sort((a,b)=>b.xp-a.xp);
  let granted=0;
  for(const [index,unit] of eligible.entries()){
    const amount=Math.min(maxXp-unit.xp,Math.floor(available/(eligible.length-index)));
    unit.xp+=amount;
    available-=amount;
    granted+=amount;
  }
  return granted;
}

const legacyTraitOdds={"Concentração Total": 4, "Reforço Amaldiçoado": 5, "Haki do Armamento": 10, "Ten": 10, "Kaidō": 20, "Shunpo": 20, "Modo Sábio": 25, "Respiração do Trovão": 25, "Haki do Rei": 50, "Instinto Superior": 100, "Restrição Celestial": 125, "Haki da Observação": 125, "Zenkai": 200, "Full Counter": 250, "The World": 500, "Voto de Nen": 1000, "Made in Heaven": 2000};

export function saleSettings(saved){
  // Novo sistema simplificado de Auto-Sell, com retrocompatibilidade para saves antigos.
  const list=value=>Array.isArray(value)?value:[];
  const tiers=[...new Set(list(saved?.tiers).map(Number).filter(i=>Number.isInteger(i)&&i>=1&&i<=TIERS.length))].sort((a,b)=>a-b);
  const keepCharacters=[...new Set(list(saved?.keepCharacters).filter(id=>Object.hasOwn(CHARACTERS,id)))];
  const shinyRule=['all','first','none'].includes(saved?.shinyRule)?saved.shinyRule:'all';
  const keepFirstNormal=saved?.keepFirstNormal!==false;
  const rawMin=Number(saved?.minTraitTier);
  const minTraitTier=Number.isInteger(rawMin)&&rawMin>=1&&rawMin<=9?rawMin:1;
  const old=saved?.legacy??(saved?.characters||saved?.traitRules?saved:null);
  const settings={enabled:saved?.enabled===true,tiers,keepFirstNormal,shinyRule,minTraitTier,keepCharacters};
  if(old)settings.legacy={characters:list(old.characters),traitRules:old.traitRules??{}};
  return settings;
}

export function describeAutoSell(saved){
  const s=saleSettings(saved);
  if(!s.enabled)return 'Venda automática desligada. Todos os novos recrutas entram na coleção.';
  if(!s.tiers.length)return 'Ligada, mas nenhuma raridade selecionada para venda.';
  const tierNames=s.tiers.map(i=>TIERS[i-1]).join(', ');
  const prot=[];
  if(s.keepFirstNormal)prot.push('1ª cópia normal de cada personagem');
  if(s.shinyRule==='all')prot.push('todos os Shinies');
  else if(s.shinyRule==='first')prot.push('1º Shiny de cada personagem');
  if(s.minTraitTier<=8)prot.push(s.minTraitTier===1?'qualquer Trait':`Traits ${TIERS[s.minTraitTier-1]}+`);
  if(s.keepCharacters.length)prot.push(`${s.keepCharacters.length} personagem(ns) VIP`);
  return `Vende automaticamente: ${tierNames}.`+(prot.length?` Mantém sempre: ${prot.join(', ')}.`:' Sem proteções ativas.');
}

function traitTierOf(t){return t?.tier??(TIERS.indexOf(t?.rarity)+1);}

function saleMatches(saved,unit,collection){
  const s=saleSettings(saved);
  if(!s.enabled)return false;
  const tier=CHARACTERS[unit.id].tier;
  if(s.legacy){
    if(!s.tiers.includes(tier)&&!s.legacy.characters.includes(unit.id))return false;
    if(!collection.some(c=>c.id===unit.id&&!!c.shiny===!!unit.shiny))return false;
    if(!unit.trait)return true;
    const rule=s.legacy.traitRules[tier];
    const odds=legacyTraitOdds[unit.trait];
    return !!(odds&&rule&&(odds<rule.below||rule.names?.includes(unit.trait)));
  }
  if(!s.tiers.includes(tier))return false;
  if(s.keepCharacters.includes(unit.id))return false;
  if(unit.shiny){
    if(s.shinyRule==='all')return false;
    if(s.shinyRule==='first'&&!collection.some(c=>c.id===unit.id&&c.shiny))return false;
  }else if(s.keepFirstNormal&&!collection.some(c=>c.id===unit.id&&!c.shiny)){
    return false;
  }
  const names=slotTraits(unit);
  if(names.length&&s.minTraitTier<=8){
    const highestTraitTier=Math.max(...names.map(n=>traitTierOf(TRAITS.find(t=>t.name===n))));
    if(highestTraitTier>=s.minTraitTier)return false;
  }
  return true;
}

function settle(state,battle){
  const entry={won:battle.result.winner===0&&battle.result.reason==='eliminação',gold:0,xp:0,reserveXp:0,teamXp:0,recruit:null,boss:battle.boss,label:battle.enemy.name,end:battle.end};
  const fallen=battle.result.events.filter(e=>e.type==='cai'&&e.actor.startsWith('0:'));
  if(fallen.length){
    state.recovery??={};
    for(const e of fallen){
      const unit=battle.team[Number(e.actor.slice(2))];
      const when=battle.start+(battle.end-battle.start)*Math.min(1,e.time/Math.max(1,battle.result.seconds*1000));
      state.recovery[unit.uid]=Math.ceil(when)+(battle.recoveryMs??RECOVERY_MS);
    }
    if(fallen.length===battle.team.length)state.partyRecovery=battle.end+(battle.recoveryMs??RECOVERY_MS);
  }
  if(entry.won){
    state.wins++;state.streak=0;
    if(battle.area===2&&!battle.boss) state.finalWins++;
    entry.xp=Math.round((8+1.25*battle.level)*(battle.boss?3:battle.elite?2:1)*(1+(battle.xpBonus??0)));
    entry.gold=battle.goldReward??Math.round((6+2*battle.level)*(battle.boss?8:(battle.elite?2:1)*(1+(battle.goldBonus??0))));
    if(battle.towerFloor && battle.towerFloor===(state.towerCleared??0)+1){
      state.towerCleared=battle.towerFloor;
      state.traitItems=(state.traitItems??0)+towerPrize(battle.towerFloor);
    }
    state.gold+=entry.gold;
    for(const fighter of battle.team){const copy=state.collection.find(c=>c.uid===fighter.uid);if(copy){const previous=copy.xp;copy.xp=Math.min(xpTo(levelCap(state)),previous+entry.xp);entry.teamXp+=copy.xp-previous;}}
    entry.reserveXp=shareExperience(state,battle,entry.xp);
    if(battle.recruit){
      const {id,shiny}=battle.recruit;
      const key=id+(shiny?'-shiny':'');
      const serial=1+(state.serials?.[key]??state.collection.reduce((max,c)=>c.id===id&&!!c.shiny===!!shiny?Math.max(max,c.serial):max,0));
      (state.serials??={})[key]=serial;
      const copy={...battle.recruit,uid:`catch-${state.index}`,xp:xpTo(Math.min(levelCap(state),battle.level)),serial};
      recordDex(state,copy);
      const tier=CHARACTERS[id].tier;
      if(saleMatches(state.autoSell,copy,state.collection)){
        entry.sold=copy;entry.saleGold=SALE_PRICES[tier-1];entry.gold+=entry.saleGold;state.gold+=entry.saleGold;
        if(tier>=5){state.items??={};state.items.essence=(state.items.essence??0)+(tier-4);}
      }else{state.collection.push(copy);entry.recruit=copy;}
    }
    if(battle.boss && !battle.towerFloor){
      state.completed=true;
      state.unlocked=Math.min(WORLDS.length-1,Math.max(state.unlocked??0,(state.world??0)+1));
    }
    if(state.autoRoutes){
      const areas=worldOf(state).areas;
      state.area=Math.max(state.area,areas.findLastIndex(a=>a.unlock<=maxLevel(state)));
    }
  }else{
    state.losses++;
    if(!battle.boss && ++state.streak>=3){if(state.area>0)state.area--;state.streak=0;}
  }
  state.log=[entry,...state.log].slice(0,25);
  return entry;
}

export function advance(state,now,budget=null,encounterLimit=Infinity){
  if(typeof budget==='number'){encounterLimit=budget;budget=null;}
  if(state.autoSell)state.autoSell=saleSettings(state.autoSell);
  if(state.world===undefined){
    state.world=0;state.unlocked=state.completed?1:0;state.journey={};state.autoRoutes=true;
    state.paused=false;
    if(!state.running&&!state.pending)state.nextAt=now;
    state.running=true;
  }
  const previous=state.clock;
  if(now<previous) return [];
  const cap=Math.min(now,previous+12*HOUR);
  const entries=[];
  function canStart(at){
    if(!budget)return true;
    if(budget.remaining>0){budget.remaining--;return true;}
    budget.exhausted=true;
    state.clock=at;
    return false;
  }
  while(true){
    if(state.pending){
      if(state.pending.end>cap) break;
      const battle=state.pending;
      state.pending=null;
      entries.push(settle(state,battle));
      state.waitDuration=waitFor(state);
      state.nextAt=battle.end+state.waitDuration;
      state.running=!state.paused;
      if(state.destination!==undefined)travel(state,state.destination);
      else if(state.autoRoutes && state.running && battle.boss && state.completed && state.world<state.unlocked)travel(state,state.world+1);
      if(entries.length>=encounterLimit){
        state.clock=Math.max(previous,battle.end);
        return entries;
      }
      continue;
    }
    if(state.towerQueued && state.team.length){
      const when=Math.max(previous,state.towerQueued.at,firstReady(state),entries.at(-1)?.end??0);
      if(when<=cap){
        if(!canStart(when))return entries;
        delete state.towerQueued;
        state.pending=makeBattle(state,when,true,(state.towerCleared??0)+1);
        continue;
      }
    }
    if(!state.team.length||!state.running||state.nextAt>cap) break;
    const start=Math.max(state.nextAt,firstReady(state));
    if(start>cap)break;
    if(!canStart(Math.max(previous,start)))return entries;
    if(state.autoRoutes && state.completed && state.world<state.unlocked)travel(state,state.world+1);
    state.pending=makeBattle(state,start,!!state.autoRoutes && readyForBoss(state));
  }
  if(now>cap){
    if(state.pending){
      // Preserve the fight and the remaining replay when the AFK window ends mid-battle.
      state.pending.start+=now-cap;
      state.pending.end+=now-cap;
    }
    state.running=!state.paused;
    state.nextAt=now+waitFor(state);
  }
  state.clock=now;
  return entries;
}

export const AWAY_THRESHOLD=10*60*1000;
export const AFK_ENCOUNTER_LIMIT=2400;
function newWindow(state,start){
  return {start,encounters:0,wins:0,gold:0,teamXp:0,reserveXp:0,firstRecruit:state.collection.length,recruitUids:[]};
}
function hydrateAwayRecruits(state){
  if(state.awayWindow&&!Array.isArray(state.awayWindow.recruitUids)){
    const start=Number.isInteger(state.awayWindow.firstRecruit)?Math.max(0,state.awayWindow.firstRecruit):state.collection.length;
    state.awayWindow.recruitUids=state.collection.slice(start).map(u=>u.uid);
  }
  if(Array.isArray(state.awayReports)){
    for(const r of state.awayReports){
      if(r&&!Array.isArray(r.recruitUids)){
        const start=Number.isInteger(r.firstRecruit)?Math.max(0,r.firstRecruit):state.collection.length;
        const end=Number.isInteger(r.lastRecruit)?Math.max(start,r.lastRecruit):start;
        r.recruitUids=state.collection.slice(start,end).map(u=>u.uid);
      }
    }
  }
}
export function advanceWithPresence(state,now,observedAt=null,budget=null){
  if(!state.dex){
    state.dex={normal:[],shiny:[],traits:[]};
    for(const u of state.collection)recordDex(state,u);
    for(const e of state.log??[]){if(e.recruit||e.sold)recordDex(state,e.recruit??e.sold);}
    for(const id of Object.keys(CHARACTERS)){
      if(state.serials?.[id]>0)recordDex(state,{id});
      if(state.serials?.[id+'-shiny']>0)recordDex(state,{id,shiny:true});
    }
  }
  if(Object.hasOwn(state,'traitFragments')){
    state.traitItems=(state.traitItems??0)+Math.max(0,Math.floor(state.traitFragments)||0);
    delete state.traitFragments;
  }
  hydrateAwayRecruits(state);
  const window=state.awayWindow??=newWindow(state,state.clock);
  const all=[];
  function run(until){
    const w=state.awayWindow;
    const limit=w.start+12*HOUR;
    const remaining=AFK_ENCOUNTER_LIMIT-w.encounters;
    if(remaining>0&&until>=state.clock&&state.clock<=limit){
      const entries=advance(state,Math.min(until,limit),budget,remaining);
      for(const e of entries){
        if(e.sold){w.sold=(w.sold??0)+1;w.saleGold=(w.saleGold??0)+e.saleGold;}
        if(e.recruit?.uid)(w.recruitUids??=[]).push(e.recruit.uid);
        w.encounters++;w.wins+=Number(e.won);w.gold+=e.gold;w.teamXp+=e.teamXp;w.reserveXp+=e.reserveXp;all.push(e);
      }
    }
    if(!budget?.exhausted&&until>state.clock&&(until>limit||w.encounters>=AFK_ENCOUNTER_LIMIT)){
      if(w.encounters>=AFK_ENCOUNTER_LIMIT)w.encounterLimitReached=true;
      const shift=until-state.clock;
      if(state.pending){state.pending.start+=shift;state.pending.end+=shift;}
      state.nextAt+=shift;state.clock=until;
    }
  }
  if(Number.isFinite(observedAt)&&observedAt>window.start){
    const seen=Math.min(now,observedAt);
    run(seen);
    if(budget?.exhausted)return all;
    if(seen-window.start>=AWAY_THRESHOLD){
      (state.awayReports??=[]).push({...window,recruitUids:[...(window.recruitUids??[])],end:seen,lastRecruit:state.collection.length});
      if(state.awayReports.length>10)state.awayReports=state.awayReports.slice(-10);
    }
    state.awayWindow=newWindow(state,seen);
  }
  run(now);
  return all;
}

export function startExploration(state,now){
  if(state.pending?.boss||state.running)return false;
  state.running=true;
  if(!state.pending)state.nextAt=Math.max(now,state.nextAt);
  return true;
}

export const TOWER_LIMIT=30;
export const towerPrize=floor=>floor%10===0?3:floor%5===0?2:1;
export function towerAffix(floor){
  return TOWER_AFFIXES[Math.floor((Math.max(1,floor)-1)/5)%TOWER_AFFIXES.length];
}
export function raidToday(now){
  const {day,nextAt}=dailyCycle(now);
  const index=Math.floor(Date.parse(day+'T00:00:00Z')/86400000)%WORLDS.length;
  return {day,nextAt,index,boss:WORLDS[index].boss};
}
export function weeklyTowerToday(now){
  const cycle=weeklyCycle(now);
  const rule=WEEKLY_TOWER_RULES[Math.abs(cycle.index)%WEEKLY_TOWER_RULES.length];
  return {...cycle,rule};
}
const TRANSCENDENT_IDS=Object.values(CHARACTERS).filter(c=>c.tier===8).map(c=>c.id);
function ballBoss(index,level,factor,raid){
  const b=WORLDS[index].boss,g=scale(level)*factor;
  const [hp,attack,defense,resistance]=b.base.map(v=>Math.round(v*g));
  return {name:b.name,kind:b.arenaKind??b.kind??'freeza-boss',skill:bossKits[b.arenaKind]?.name??'Ofensiva de '+b.name,color:b.color,role:'Combatente',
    sprite:'enemy-'+(index+1)+'-5',level,scale:g,speed:106,hp:raid?10000000:hp,attack,magic:attack,defense,resistance,x:60,y:50};
}
function transcendentBoss(slotIndex,level,factor){
  const id=TRANSCENDENT_IDS[slotIndex%TRANSCENDENT_IDS.length];
  const f=fighter({id,xp:xpTo(level),shiny:false,trait:null},[60,50],null,true);
  f.hp=Math.round(f.hp*factor*0.95);
  f.attack=Math.round(f.attack*factor*0.85);
  f.magic=Math.round(f.magic*factor*0.85);
  f.defense=Math.round(f.defense*factor*0.85);
  f.resistance=Math.round(f.resistance*factor*0.85);
  return f;
}
export function towerEnemies(floor){
  const index=(floor-1)%WORLDS.length;
  const level=Math.min(100,62+Math.floor((floor-1)*.45));
  const factor=.85+.014*(floor-1)+(floor>30?.016*(floor-30):0);
  if(floor%10===0&&TRANSCENDENT_IDS.length){
    const count=Math.min(4,Math.floor(floor/10));
    const offset=Math.floor(floor/10)-1;
    return Array.from({length:count},(_,i)=>transcendentBoss(offset*3+i,level,factor*(i===0?1:0.78)));
  }
  const team=[ballBoss(index,level,factor,false)];
  if(floor>TOWER_LIMIT){
    const count=Math.min(3,1+Math.floor((floor-31)/10));
    for(let i=1;i<=count;i++)team.push(ballBoss((index+i)%WORLDS.length,level,factor*.65,false));
  }
  return team;
}
export function weeklyTowerEnemies(floor,weekIndex=0){
  const level=Math.min(100,55+floor*3);
  const factor=0.72+0.025*(floor-1);
  const base=(Math.abs(weekIndex)*3+floor-1)%WORLDS.length;
  const count=floor>=12?3:floor>=6?2:1;
  return Array.from({length:count},(_,i)=>ballBoss((base+i)%WORLDS.length,level,factor*(i===0?1:0.7),false));
}
function ballChallenge(state,action,now){
  const kind=action.type; // 'raid' | 'tower' | 'weeklyTower'
  const raid=kind==='raid',weekly=kind==='weeklyTower';
  const daily=raidToday(now),wt=weeklyTowerToday(now);
  const used=state.raid?.day===daily.day?state.raid.attempts:0;
  const weeklyCleared=state.weeklyTower?.week===wt.week?state.weeklyTower.cleared:0;
  const floor=weekly?weeklyCleared+1:(state.towerCleared??0)+1;
  if(action.sequence!==(state.ballSequence??0))return false;
  if(raid){
    if(used>=3||action.day!==daily.day)return false;
  }else if(weekly){
    if((state.unlocked??0)<5||floor>WEEKLY_TOWER_FLOORS||action.week!==wt.week||action.floor!==floor)return false;
  }else{
    if((state.unlocked??0)<9||state.towerQueued||state.pending?.towerFloor||action.floor!==floor)return false;
  }
  const available=state.team.filter(uid=>readyAt(state,uid)<=now);
  if(!available.length)return false;
  if(weekly&&state.team.some(uid=>!wt.rule.allow(CHARACTERS[state.collection.find(u=>u.uid===uid).id])))return false;
  const mastery=dexMastery(state);
  const leader=available.includes(state.leader)?CHARACTERS[state.collection.find(u=>u.uid===state.leader).id]:null;
  const left=available.map(uid=>fighter(state.collection.find(u=>u.uid===uid),state.positions[uid],leader,true,mastery));
  const right=raid?[ballBoss(daily.index,90,1,true)]:weekly?weeklyTowerEnemies(floor,wt.index):towerEnemies(floor);
  const affix=!raid&&!weekly?towerAffix(floor):null;
  if(affix){left.forEach(affix.apply);right.forEach(affix.apply);}
  const limit=raid?60:120;
  const match=finishDuel(createDuel(left,right,limit));
  const damage=Math.round(match.combat.log.reduce((sum,e)=>sum+(e.type==='dano'&&e.actor?.startsWith('0:')&&e.target?.startsWith('1:')?e.hp:0),0));
  const fallen=match.sides[0].team.filter(f=>!match.combat.alive(f));
  if(fallen.length){
    const until=now+upgradeValue(state,'enfermaria')*1000;
    state.recovery??={};
    for(const f of fallen)state.recovery[f.uid]=Math.max(until,state.recovery[f.uid]??0);
    if(fallen.length===available.length)state.partyRecovery=Math.max(until,state.partyRecovery??0);
  }
  let items=0,rewardGold=0,bonusItems={};
  const newMilestones=[];
  if(raid){
    items=1;
    const prevClaimed=state.raid?.day===daily.day&&Array.isArray(state.raid.claimed)?raidClaims(state.raid.claimed):[];
    const bestToday=Math.max(used?(state.raid.bestDamage??0):0,damage);
    for(const m of RAID_MILESTONES){
      if(bestToday>=m.damage&&!prevClaimed.includes(m.damage)){
        prevClaimed.push(m.damage);
        newMilestones.push(m.label);
        grantItems(state,m);
        rewardGold+=m.gold??0;
        items+=m.traitItems??0;
        if(m.items)for(const [k,v] of Object.entries(m.items))bonusItems[k]=(bonusItems[k]??0)+v;
      }
    }
    state.raid={day:daily.day,attempts:used+1,bestDamage:bestToday,bestEver:Math.max(state.raid?.bestEver??0,damage),claimed:prevClaimed,lastDamage:damage};
    state.traitItems=(state.traitItems??0)+1;
  }else if(weekly&&match.result==='Vitória'){
    state.weeklyTower={week:wt.week,cleared:floor};
    const bundle={items:{essence:1}};
    if(floor%3===0&&floor!==15){bundle.traitItems=1;items+=1;}
    if(floor===10){bundle.items.catalyst=1;}
    if(floor===15){bundle.items.traitLock=1;bundle.traitItems=(bundle.traitItems??0)+2;items+=2;}
    grantItems(state,bundle);
    bonusItems=bundle.items;
  }else if(!weekly&&match.result==='Vitória'){
    state.towerCleared=floor;
    items=towerPrize(floor);
    state.traitItems=(state.traitItems??0)+items;
    if(floor%10===0){
      const ess=Math.min(5,1+Math.floor(floor/20));
      grantItems(state,{items:{essence:ess}});
      bonusItems.essence=ess;
    }
  }
  state.ballSequence=(state.ballSequence??0)+1;
  state.ballRun={physics:5,launchSeed:match.launchSeed,sequence:state.ballSequence,left,right,limit,raid,weekly,floor,damage,items,reward:rewardGold,bonusItems,milestones:newMilestones,affix:affix?.name??null,result:match.result};
  return true;
}
export function challenge(state,now){
  if(!readyForBoss(state))return false;
  if(state.pending||firstReady(state)>now)return false;
  state.pending=makeBattle(state,now,true);
  return true;
}

export function formationSlots(state){
  return state.slots??Array.from({length:4},(_,i)=>state.team[i]??null);
}

export function formationCost(state,slots=state.team){
  return slots.reduce((n,uid)=>n+(uid?(state.collection.find(u=>u.uid===uid)?.nen?2:1):0),0);
}
export function equip(state,uid,replaced,requestedSlot){
  if(!state.collection.some(c=>c.uid===uid)||state.team.includes(uid))return false;
  const slots=formationSlots(state).slice();
  const index=requestedSlot??(replaced?slots.indexOf(replaced):slots.indexOf(null));
  if(!Number.isInteger(index)||index<0||index>=4||slots[index]!== (replaced??null))return false;
  const next=slots.slice();next[index]=uid;
  if(formationCost(state,next)>4)return false;
  state.positions[uid]=(state.positions[replaced]??state.slotPositions?.[index]??position[index]).slice();
  if(!state.leader||state.leader===replaced)state.leader=uid;
  slots[index]=uid;
  state.slots=slots;state.team=slots.filter(Boolean);
  return true;
}

function removeMember(state,uid){
  const slots=formationSlots(state).slice(),index=slots.indexOf(uid);
  if(!uid||index<0)return false;
  state.slotPositions??={};
  state.slotPositions[index]=state.positions[uid];
  slots[index]=null;
  state.slots=slots;state.team=slots.filter(Boolean);
  if(state.leader===uid)state.leader=state.team[0]??null;
  return true;
}

function travel(state,index){
  state.journey[state.world]={area:state.area,completed:state.completed,finalWins:state.finalWins,bossGoal:state.bossGoal??15};
  const progress=state.journey[index]??{area:0,completed:false,finalWins:0,bossGoal:15+10*index};
  Object.assign(state,{bossGoal:15},progress,{world:index,streak:0});
  delete state.destination;
}
const STAT_KEYS=['hp','attack','magic','defense','resistance','speed'];
export function unitPower(unit, leader=null){
  const stats=fighter(unit,undefined,leader);
  return STAT_KEYS.reduce((sum,key)=>sum+stats[key],0);
}
export function formationPower(unit,leader=null,atMaxLevel=true){
  const f=fighter(atMaxLevel?{...unit,xp:xpTo(100)}:unit,undefined,leader);
  const health=f.hp/5;
  const protection=(f.defense+f.resistance)/2;
  const offense=(f.magicBasic?f.magic:f.attack)*f.speed/100;
  switch(f.role){
    case 'Guardião': return Math.round(.25*offense+.40*health+.35*protection);
    case 'Suporte': return Math.round(.55*offense+.25*health+.20*protection);
    case 'Mágico': return Math.round(.80*offense+.10*health+.10*protection);
    default: return Math.round(.70*offense+.15*health+.15*protection);
  }
}
export function projectedPower(unit,leader=null){
  return unitPower({...unit,xp:xpTo(100)},leader);
}
export function leaderApplies(leader, member){
  return leaderBuff(leader,member).some(Boolean);
}

const ROLE_ORDER={Guardião:0,Combatente:1,Mágico:2,Suporte:3};
const PRESET_COORDS={
  padrao:[[74,44],[56,76],[36,26],[22,60]],
  espalhado:[[82,20],[62,82],[24,20],[20,82]],
  proteger:[[72,50],[46,42],[46,58],[58,24]],
};
export function applyFormationPreset(state, preset='padrao'){
  const coords=PRESET_COORDS[preset];
  if(!coords||!state.team.length)return false;
  const ordered=state.team.slice().sort((a,b)=>{
    const ca=CHARACTERS[state.collection.find(u=>u.uid===a).id];
    const cb=CHARACTERS[state.collection.find(u=>u.uid===b).id];
    return (ROLE_ORDER[ca.role]??9)-(ROLE_ORDER[cb.role]??9);
  });
  ordered.forEach((uid,i)=>{state.positions[uid]=coords[i].slice();});
  return true;
}

export function autoFormation(state, mode='power', now=Date.now()){
  if(!['power','projected','balanced','area'].includes(mode)||!state.collection.length)return false;
  const enemyColor=worldOf(state).areas[state.area]?.color;
  const unitCost=u=>u.nen?2:1;
  const areaFactor=c=>mode==='area'&&enemyColor?affinity(c.color,enemyColor)/Math.sqrt(affinity(enemyColor,c.color)):1;
  function scoreWith(unit,leader){
    if(mode==='power')return unitPower(unit,leader);
    if(mode==='projected')return projectedPower(unit,leader);
    return formationPower(unit,leader,false)*areaFactor(CHARACTERS[unit.id]);
  }
  const cmp=(a,b)=>b.score-a.score||b.u.xp-a.u.xp||b.tier-a.tier||a.u.serial-b.u.serial;
  // Best representative per (character.id, cost) as candidate leader.
  const leaderMap=new Map();
  for(const u of state.collection){
    const c=CHARACTERS[u.id],cost=unitCost(u),key=`${u.id}:${cost}`;
    const item={u,cost,score:scoreWith(u,c),role:c.role,tier:c.tier};
    const prev=leaderMap.get(key);
    if(!prev||cmp(item,prev)<0)leaderMap.set(key,item);
  }
  let best=null;
  for(const lead of leaderMap.values()){
    const leaderCard=CHARACTERS[lead.u.id];
    const rem=4-lead.cost;
    const others=[];
    for(const u of state.collection){
      if(u.uid===lead.u.uid)continue;
      const cost=unitCost(u);
      if(cost>rem)continue;
      const c=CHARACTERS[u.id];
      others.push({u,cost,score:scoreWith(u,leaderCard),role:c.role,tier:c.tier});
    }
    others.sort(cmp);
    let combo=[lead];
    if(mode==='balanced'){
      const buildBalanced=pool=>{
        let budget=rem;
        const cand=[lead];
        const rolesUsed=new Set([lead.role]);
        const picked=new Set([lead.u.uid]);
        for(const role of ['Guardião','Combatente','Mágico','Suporte']){
          if(rolesUsed.has(role))continue;
          const match=pool.find(x=>x.role===role&&!picked.has(x.u.uid)&&x.cost<=budget);
          if(match){cand.push(match);picked.add(match.u.uid);rolesUsed.add(role);budget-=match.cost;}
        }
        for(const x of pool){
          if(budget<=0)break;
          if(!picked.has(x.u.uid)&&x.cost<=budget){cand.push(x);picked.add(x.u.uid);budget-=x.cost;}
        }
        return {cand,roles:rolesUsed.size,score:cand.reduce((s,x)=>s+x.score,0)};
      };
      const withAny=buildBalanced(others);
      const singlesOnly=buildBalanced(others.filter(x=>x.cost===1));
      combo=singlesOnly.roles>withAny.roles||(singlesOnly.roles===withAny.roles&&singlesOnly.score>withAny.score+1e-9)?singlesOnly.cand:withAny.cand;
    }else{
      const singles=others.filter(x=>x.cost===1).slice(0,rem);
      const doubles=others.filter(x=>x.cost===2).slice(0,Math.floor(rem/2));
      let bestSub=-1;
      for(let d=0;d<=doubles.length;d++){
        const candidate=[lead,...doubles.slice(0,d),...singles.slice(0,rem-d*2)];
        const total=candidate.reduce((s,x)=>s+x.score,0);
        if(total>bestSub){bestSub=total;combo=candidate;}
      }
    }
    const score=combo.reduce((s,x)=>s+x.score,0);
    const roles=mode==='balanced'?new Set(combo.map(x=>x.role)).size:0;
    if(!best||roles>best.roles||(roles===best.roles&&score>best.score+1e-9)){
      best={combo,lead:lead.u,score,roles};
    }
  }
  if(!best)return false;
  best.combo.sort((a,b)=>(ROLE_ORDER[a.role]??9)-(ROLE_ORDER[b.role]??9)||b.score-a.score);
  const units=best.combo.map(x=>x.u);
  const wasEmpty=!state.team.length;
  const slots=Array.from({length:4},(_,i)=>units[i]?.uid??null);
  state.slots=slots;
  state.team=slots.filter(Boolean);
  state.leader=best.lead.uid;
  applyFormationPreset(state,'padrao');
  if(wasEmpty&&!state.pending)state.nextAt=now;
  return true;
}

function allTraits(unit){return [...new Set([...slotTraits(unit,0),...slotTraits(unit,1)])];}
function recordDex(state,unit){
  if(!unit||!Object.hasOwn(CHARACTERS,unit.id))return;
  const dex=state.dex??={normal:[],shiny:[],traits:[]};
  const bucket=unit.shiny?(dex.shiny??=[]):(dex.normal??=[]);
  if(!bucket.includes(unit.id))bucket.push(unit.id);
  for(const name of allTraits(unit)){
    const traits=dex.traits??=[];
    if(!traits.includes(name))traits.push(name);
  }
}
export function dexSummary(state){
  const normal=new Set(Array.isArray(state.dex?.normal)?state.dex.normal:[]);
  const shiny=new Set(Array.isArray(state.dex?.shiny)?state.dex.shiny:[]);
  const traitsSeen=new Set(Array.isArray(state.dex?.traits)?state.dex.traits:[]);
  const counts=new Map(),traitCounts=new Map();
  for(const u of state.collection){
    if(!Object.hasOwn(CHARACTERS,u.id))continue;
    if(u.shiny)shiny.add(u.id);else normal.add(u.id);
    counts.set(u.id,(counts.get(u.id)??0)+1);
    for(const name of allTraits(u)){traitsSeen.add(name);traitCounts.set(name,(traitCounts.get(name)??0)+1);}
  }
  const worldsByUniverse=new Map();
  for(const w of WORLDS){
    if(!worldsByUniverse.has(w.universe))worldsByUniverse.set(w.universe,[]);
    worldsByUniverse.get(w.universe).push(w.name);
  }
  const characters=Object.values(CHARACTERS).map(c=>({
    ...c,normal:normal.has(c.id),shiny:shiny.has(c.id),seen:normal.has(c.id)||shiny.has(c.id),
    count:counts.get(c.id)??0,worlds:worldsByUniverse.get(c.universe)??[]
  })).sort((a,b)=>a.tier-b.tier||a.name.localeCompare(b.name,'pt-BR'));
  const traits=TRAITS.map(t=>({...t,seen:traitsSeen.has(t.name),count:traitCounts.get(t.name)??0}));
  return {
    characters,traits,
    totals:{
      seenChars:characters.filter(c=>c.seen).length,totalChars:characters.length,
      shinyChars:characters.filter(c=>c.shiny).length,
      seenTraits:traits.filter(t=>t.seen).length,totalTraits:traits.length
    }
  };
}

export function canSellUnit(state, uid){
  if(!uid||state.collection.length<=1||state.team.includes(uid))return false;
  const unit=state.collection.find(u=>u.uid===uid);
  return !!unit&&unit.locked!==true;
}
function toggleLock(state, uid, locked){
  if(typeof uid!=='string'||typeof locked!=='boolean')return false;
  const unit=state.collection.find(u=>u.uid===uid);
  if(!unit||Boolean(unit.locked)===locked)return false;
  if(locked)unit.locked=true;else delete unit.locked;
  return true;
}
export function duplicateSellCandidates(state,{includeCommonTraits=false}={}){
  const teamSet=new Set(state.team);
  const traitOdds=new Map(TRAITS.map(t=>[t.name,t.odds]));
  const groups=new Map();
  for(const u of state.collection){
    const key=`${u.id}:${u.shiny?1:0}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(u);
  }
  const candidates=[];
  for(const list of groups.values()){
    if(list.length<=1)continue;
    const sorted=list.slice().sort((a,b)=>{
      return projectedPower(b)-projectedPower(a)||b.xp-a.xp||a.serial-b.serial;
    });
    for(const u of sorted.slice(1)){
      if(teamSet.has(u.uid)||u.locked||u.shiny)continue;
      const names=allTraits(u);
      if(names.length&&(!includeCommonTraits||names.length>1||(traitOdds.get(names[0])??Infinity)>25))continue;
      candidates.push(u);
    }
  }
  return candidates;
}

export function sellUnit(state, uid){
  if(!canSellUnit(state,uid))return false;
  hydrateAwayRecruits(state);
  const index=state.collection.findIndex(u=>u.uid===uid);
  const [unit]=state.collection.splice(index,1);
  recordDex(state,unit);
  const tier=CHARACTERS[unit.id].tier;
  const gold=SALE_PRICES[tier-1]??0;
  state.gold+=gold;
  if(tier>=5){state.items??={};state.items.essence=(state.items.essence??0)+(tier-4);}
  delete state.positions?.[uid];
  if(state.recovery)delete state.recovery[uid];
  if(state.awayWindow&&index<state.awayWindow.firstRecruit)state.awayWindow.firstRecruit--;
  if(Array.isArray(state.awayReports)){
    for(const r of state.awayReports){
      if(index<r.firstRecruit)r.firstRecruit--;
      if(index<r.lastRecruit)r.lastRecruit--;
    }
  }
  return gold;
}

export function goldShopPrice(item,bought=0){
  return item.base+item.step*bought;
}
export function resolveDefenseSquad(state){
  const key=state.defensePreset;
  const preset=key&&PRESET_SLOTS.includes(key)?state.presets?.[key]:null;
  const byUid=new Map(state.collection.map(u=>[u.uid,u]));
  const rawTeam=preset?.team?.filter(uid=>byUid.has(uid))??[];
  const usePreset=rawTeam.length>0&&formationCost(state,rawTeam)<=4;
  const team=usePreset?rawTeam:state.team.filter(uid=>byUid.has(uid));
  const leader=usePreset?(team.includes(preset.leader)?preset.leader:team[0]):state.leader;
  const positions=usePreset?{...state.positions,...preset.positions}:state.positions;
  return {team,leader,positions};
}
function savePreset(state,slot){
  if(!PRESET_SLOTS.includes(slot)||!state.team.length)return false;
  state.presets??={};
  const pos={};
  for(const uid of state.team)pos[uid]=(state.positions[uid]??[50,50]).slice();
  state.presets[slot]={team:state.team.slice(),slots:formationSlots(state).slice(),leader:state.leader,positions:pos};
  return true;
}
function loadPreset(state,slot,now){
  const p=PRESET_SLOTS.includes(slot)?state.presets?.[slot]:null;
  if(!p||!Array.isArray(p.team))return false;
  const validIds=new Set(state.collection.map(u=>u.uid));
  const nextSlots=(p.slots??p.team).slice(0,4).map(uid=>uid&&validIds.has(uid)?uid:null);
  while(nextSlots.length<4)nextSlots.push(null);
  const team=nextSlots.filter(Boolean);
  if(!team.length||formationCost(state,team)>4)return false;
  const wasEmpty=!state.team.length;
  state.slots=nextSlots;
  state.team=team;
  state.leader=team.includes(p.leader)?p.leader:team[0];
  for(const uid of team){
    const c=p.positions?.[uid];
    if(Array.isArray(c)&&c.length===2&&c.every(Number.isFinite))state.positions[uid]=c.slice();
  }
  if(wasEmpty&&!state.pending)state.nextAt=now;
  return true;
}
function awakenUnit(state,action){
  const unit=state.collection.find(u=>u.uid===action.uid);
  const cost=awakenCost(unit);
  if(!unit||!cost||state.gold<cost.gold)return false;
  if(action.useEssence){
    if(!((state.items?.essence??0)>=cost.essence))return false;
    state.gold-=cost.gold;
    state.items.essence-=cost.essence;
  }else{
    const sac=state.collection.find(u=>u.uid===action.sacrificeUid);
    if(!sac||sac.uid===unit.uid||sac.id!==unit.id||state.team.includes(sac.uid)||sac.locked===true||state.collection.length<=1)return false;
    hydrateAwayRecruits(state);
    const idx=state.collection.findIndex(u=>u.uid===sac.uid);
    state.collection.splice(idx,1);
    recordDex(state,sac);
    delete state.positions?.[sac.uid];
    if(state.recovery)delete state.recovery[sac.uid];
    if(state.awayWindow&&idx<state.awayWindow.firstRecruit)state.awayWindow.firstRecruit--;
    if(Array.isArray(state.awayReports)){
      for(const r of state.awayReports){
        if(idx<r.firstRecruit)r.firstRecruit--;
        if(idx<r.lastRecruit)r.lastRecruit--;
      }
    }
    state.gold-=cost.gold;
  }
  unit.stars=cost.next;
  return true;
}
function applySuggestedFormation(state,action,now){
  const {team,leader}=action;
  if(!Array.isArray(team)||!team.length||team.length>4||
    team.some(uid=>typeof uid!=='string')||new Set(team).size!==team.length||!team.includes(leader))return false;
  const units=team.map(uid=>state.collection.find(unit=>unit.uid===uid));
  if(units.some(unit=>!unit)||units.reduce((cost,unit)=>cost+(unit.nen?2:1),0)>4)return false;
  const wasEmpty=!state.team.length;
  state.team=team.slice();
  state.slots=Array.from({length:4},(_,i)=>team[i]??null);
  state.leader=leader;
  applyFormationPreset(state,'padrao');
  if(wasEmpty&&!state.pending)state.nextAt=now;
  return true;
}

export function applyGameAction(state,action,now){
  switch(action?.type){
    case 'lock': return toggleLock(state,action.uid,action.locked);
    case 'awaken': return awakenUnit(state,action);
    case 'savePreset': return savePreset(state,action.slot);
    case 'loadPreset': return loadPreset(state,action.slot,now);
    case 'setDefensePreset': {
      if(action.slot!==null&&(!PRESET_SLOTS.includes(action.slot)||!state.presets?.[action.slot]))return false;
      state.defensePreset=action.slot;
      return true;
    }
    case 'useXpTome': {
      const unit=state.collection.find(u=>u.uid===action.uid);
      const maxXp=xpTo(levelCap(state));
      if(!unit||!((state.items?.xpTome??0)>=1)||unit.xp>=maxXp)return false;
      state.items.xpTome--;
      unit.xp=Math.min(maxXp,unit.xp+250000);
      return true;
    }
    case 'useElixir': {
      if(!((state.items?.elixir??0)>=1))return false;
      const hasRec=(state.partyRecovery??0)>now||Object.values(state.recovery??{}).some(t=>t>now);
      if(!hasRec)return false;
      state.items.elixir--;
      state.partyRecovery=0;
      state.recovery={};
      return true;
    }
    case 'goldShop': {
      const item=GOLD_SHOP.find(x=>x.id===action.itemId);
      if(!item)return false;
      const {week}=weeklyCycle(now);
      if(state.goldShop?.week!==week)state.goldShop={week,bought:{}};
      const bought=state.goldShop.bought[item.id]??0;
      if(bought>=item.limit)return false;
      const price=goldShopPrice(item,bought);
      if(state.gold<price)return false;
      state.gold-=price;
      state.goldShop.bought[item.id]=bought+1;
      if(item.grant.traitItems)state.traitItems=(state.traitItems??0)+item.grant.traitItems;
      for(const [k,v] of Object.entries(item.grant)){
        if(k==='traitItems')continue;
        state.items??={};state.items[k]=(state.items[k]??0)+v;
      }
      return true;
    }
    case 'sellBatch': {
      if(!Array.isArray(action.uids)||!action.uids.length||action.uids.length>200||typeof action.includeCommonTraits!=='boolean')return false;
      const eligible=new Set(duplicateSellCandidates(state,{includeCommonTraits:action.includeCommonTraits}).map(u=>u.uid));
      const ids=new Set(action.uids);
      if(ids.size!==action.uids.length||[...ids].some(uid=>!eligible.has(uid)))return false;
      for(const uid of ids)sellUnit(state,uid);
      return true;
    }
    case 'arenaShop': {
      const count=state.arenaPurchases??0;
      const item=ARENA_SHOP.find(x=>x.id===(action.itemId??'token'));
      if(!item||action.purchase!==count||!((state.arenaTrophies??0)>=item.cost))return false;
      state.arenaTrophies-=item.cost;
      state.arenaPurchases=count+1;
      if(item.grant.traitItems)state.traitItems=(state.traitItems??0)+item.grant.traitItems;
      for(const [k,v] of Object.entries(item.grant)){
        if(k==='traitItems')continue;
        state.items??={};state.items[k]=(state.items[k]??0)+v;
      }
      return true;
    }
    case 'reroll': case 'equipTraitSlot': return changeTraitSlot(state,action);
    case 'raid': case 'tower': case 'weeklyTower': return ballChallenge(state,action,now);
    case 'nen': {
      const u=state.collection.find(c=>c.uid===action.uid);
      if(!u||!slotTraits(u).includes('Voto de Nen')||typeof action.enabled!=='boolean')return false;
      if(action.enabled&&!u.nen&&state.team.includes(u.uid)&&formationCost(state)>=4)return false;
      u.nen=action.enabled;return true;
    }
    case 'autoSell': {
      const settings=saleSettings(state.autoSell);
      if(settings.legacy){
        if(action.resetLegacy!==true)return false;
        state.autoSell=saleSettings();
        return true;
      }
      state.autoSell=settings;
      if(typeof action.enabled==='boolean')settings.enabled=action.enabled;
      if(Array.isArray(action.tiers)){
        const next=[...new Set(action.tiers.map(Number).filter(i=>Number.isInteger(i)&&i>=1&&i<=TIERS.length))].sort((a,b)=>a-b);
        settings.tiers=next;
      }
      if(Number.isInteger(action.toggleTier)&&action.toggleTier>=1&&action.toggleTier<=TIERS.length){
        const has=settings.tiers.includes(action.toggleTier);
        settings.tiers=has?settings.tiers.filter(t=>t!==action.toggleTier):[...settings.tiers,action.toggleTier].sort((a,b)=>a-b);
      }
      if(typeof action.keepFirstNormal==='boolean')settings.keepFirstNormal=action.keepFirstNormal;
      if(['all','first','none'].includes(action.shinyRule))settings.shinyRule=action.shinyRule;
      if(Number.isInteger(action.minTraitTier)&&action.minTraitTier>=1&&action.minTraitTier<=9)settings.minTraitTier=action.minTraitTier;
      if(typeof action.keepChar==='string'&&Object.hasOwn(CHARACTERS,action.keepChar)){
        const add=action.keep!==false;
        settings.keepCharacters=add?[...new Set([...settings.keepCharacters,action.keepChar])]:settings.keepCharacters.filter(id=>id!==action.keepChar);
      }
      return true;
    }
    case 'saleSetting': {
      const {group,value,checked}=action;
      if(typeof checked!=='boolean'||!['enabled','tiers'].includes(group))return false;
      if(group==='tiers'&&(!Number.isInteger(value)||value<1||value>TIERS.length))return false;
      const settings=state.autoSell=saleSettings(state.autoSell);
      if(group==='enabled')settings.enabled=checked;
      else settings.tiers=checked?[...new Set([...settings.tiers,value])].sort((a,b)=>a-b):settings.tiers.filter(v=>v!==value);
      return true;
    }
    case 'dismissAway': {
      if(!state.awayReports?.length||state.awayReports[0].end!==action.end)return false;
      state.awayReports.shift();return true;
    }
    case 'pause':
      state.running=false;state.paused=true;return true;
    case 'resume': {
      const wasPaused=Boolean(state.paused);
      state.paused=false;
      return startExploration(state,now)||wasPaused;
    }
    case 'autoRoutes':
      state.autoRoutes=action.enabled===true;return true;
    case 'world':
      if(!Number.isInteger(action.index)||action.index<0||action.index>state.unlocked)return false;
      state.autoRoutes=false;
      if(state.pending)state.destination=action.index;else travel(state,action.index);
      return true;
    case 'area': {
      const area=Number.isInteger(action.area)&&worldOf(state).areas[action.area];
      if(!area||maxLevel(state)<area.unlock||(!state.autoRoutes&&state.area===action.area))return false;
      state.autoRoutes=false;state.area=action.area;state.streak=0;return true;
    }
    case 'leader':
      if(!state.team.includes(action.uid)||state.leader===action.uid)return false;
      state.leader=action.uid;return true;
    case 'remove': return removeMember(state,action.uid);
    case 'equip': {
      const empty=!state.team.length;
      const changed=equip(state,action.uid,action.replaced,action.slot);
      if(changed&&empty&&!state.pending)state.nextAt=now;
      return changed;
    }
    case 'boss': return challenge(state,now);
    case 'upgrade': return buyUpgrade(state,action.id);
    case 'position': {
      if(!state.team.includes(action.uid))return false;
      const coords=action.coords;
      if(!Array.isArray(coords)||coords.length!==2||!coords.every(Number.isFinite))return false;
      state.positions[action.uid]=coords.map(value=>Math.max(8,Math.min(92,Math.round(value))));
      return true;
    }
    case 'autoFormation': return Array.isArray(action.team)?applySuggestedFormation(state,action,now):autoFormation(state,action.mode??'power',now);
    case 'formationPreset': return applyFormationPreset(state,action.preset);
    case 'sell': return sellUnit(state,action.uid)!==false;
    default: return false;
  }
}
